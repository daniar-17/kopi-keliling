package main

// Proxy logo brand: browser mengambil gambar dari backend ini, bukan
// langsung dari Google. Semula kartude kartu menautkan
// lh3.googleusercontent.com langsung, dan Google men-*rate limit* link
// semacam itu (429) sehingga logo tiba-tiba hilang dari halaman. Dengan
// mengambilnya sekali di sini dan menyimpan byte-nya di memori, kuota
// Google tidak lagi memengaruhi halaman, dan logo pun terlayani cepat.

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Byte gambar dikeluarkan dari sumber sekali per hari; di antaranya
// browser dilayani langsung dari cache memori backend ini.
const (
	logoCacheTTL     = 24 * time.Hour
	logoMaxByteSize  = 8 << 20 // 8 MB
	logoFetchTimeout = 15 * time.Second
)

type logoCacheEntry struct {
	ContentType string
	Data        []byte
	FetchedAt   time.Time
}

var (
	logoCacheMu sync.Mutex
	logoCache   = map[int64]logoCacheEntry{}
)

// proxyLogoURL menautkan logo brand ke proxy di backend ini, bukan ke
// sumbernya langsung, supaya kuota Google tidak memampu memandu logo padam.
func proxyLogoURL(r *http.Request, brandID int64) string {
	return fmt.Sprintf("http://%s/api/brands/%d/logo", r.Host, brandID)
}

// getBrandLogo menyalurkan gambar logo satu brand: dari cache bila masih
// segar, atau diambil sekali lagi dari sumber asal (Drive atau link foto
// lain yang dikelola admin).
func getBrandLogo(w http.ResponseWriter, r *http.Request) {
	brandID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || brandID < 1 {
		respondError(w, http.StatusBadRequest, "ID brand tidak valid")
		return
	}

	logoCacheMu.Lock()
	entry, tersimpan := logoCache[brandID]
	logoCacheMu.Unlock()

	if tersimpan && time.Since(entry.FetchedAt) < logoCacheTTL {
		writeLogo(w, entry.ContentType, entry.Data)
		return
	}

	// URL sumber disimpan admin di kolom logo_url; bisa link Drive.
	var rawURL string

	err = db.QueryRowContext(r.Context(), `
		SELECT COALESCE(logo_url, '')
		FROM brands
		WHERE id = $1 AND is_active = TRUE
	`, brandID).Scan(&rawURL)
	if err != nil {
		respondError(w, http.StatusNotFound, "Logo brand tidak ditemukan")
		return
	}

	sourceURL := resolveLogoURL(rawURL)
	if sourceURL == "" {
		respondError(w, http.StatusNotFound, "Brand ini belum punya logo")
		return
	}

	contentType, data, err := fetchLogoBytes(r.Context(), sourceURL)
	if err != nil {
		log.Printf("Gagal mengambil logo brand %d: %v", brandID, err)

		// Cache basah tetap dilayani meski sumber kebetulan gagal, agar
		// lonjakan sekali-pin tidak menjadi lubang kosong di peta.
		if tersimpan {
			writeLogo(w, entry.ContentType, entry.Data)
			return
		}

		respondError(w, http.StatusBadGateway, "Logo tidak bisa diambil dari sumber")
		return
	}

	logoCacheMu.Lock()
	logoCache[brandID] = logoCacheEntry{
		ContentType: contentType,
		Data:        data,
		FetchedAt:   time.Now(),
	}
	logoCacheMu.Unlock()

	writeLogo(w, contentType, data)
}

// fetchLogoBytes mengunduh satu berkas gambar dengan batas ukuran dan
// memvalidasi tipe kontennya benar-benar gambar.
func fetchLogoBytes(
	ctx context.Context,
	sourceURL string,
) (string, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, logoFetchTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		sourceURL,
		nil,
	)
	if err != nil {
		return "", nil, err
	}

	request.Header.Set("Accept", "image/*")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", nil, errHTTPStatus(response.StatusCode)
	}

	contentType := response.Header.Get("Content-Type")
	if !isImageContentType(contentType) {
		return "", nil, fmt.Errorf("sumber logo bukan gambar: %q", contentType)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, logoMaxByteSize+1))
	if err != nil {
		return "", nil, err
	}

	if len(data) > logoMaxByteSize {
		return "", nil, errHTTPStatus(http.StatusRequestEntityTooLarge)
	}

	if len(data) == 0 {
		return "", nil, errHTTPStatus(http.StatusNoContent)
	}

	return contentType, data, nil
}

// isImageContentType memastikan server sumber benar-benar mengirim gambar,
// bukan halaman HTML berisi peringatan izin Drive.
func isImageContentType(contentType string) bool {
	// Periksa awalannya saja; Google kadang menambahkan parameter setelah
	// tipe, misalnya "image/png;image=x".
	return strings.HasPrefix(contentType, "image/")
}

func writeLogo(w http.ResponseWriter, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write(data); err != nil {
		log.Printf("Gagal mengirim gambar logo: %v", err)
	}
}

// logoHTTPError adalah galat ringan yang membawa status HTTP sumber.
type logoHTTPError struct {
	Code int
}

func errHTTPStatus(code int) *logoHTTPError {
	return &logoHTTPError{Code: code}
}

func (e *logoHTTPError) Error() string {
	return "sumber logo merespons " + strconv.Itoa(e.Code)
}
