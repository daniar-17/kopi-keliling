package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var db *sql.DB

type HealthResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type Brand struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	LogoURL  *string `json:"logo_url"`
	IsActive bool    `json:"is_active"`
}

type Merchant struct {
	ID           int64    `json:"id"`
	MerchantName string   `json:"merchant_name"`
	BrandID      int64    `json:"brand_id"`
	BrandName    string   `json:"brand_name"`
	Phone        *string  `json:"phone"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	IsAvailable  bool     `json:"is_available"`
}

// Batas jumlah pedagang per halaman.
const (
	defaultMerchantsPerPage = 6
	maxMerchantsPerPage     = 100
)

type BrandCount struct {
	BrandName string `json:"brand_name"`
	Count     int64  `json:"count"`
}

type MerchantsMeta struct {
	Page        int64        `json:"page"`
	Limit       int64        `json:"limit"`
	Total       int64        `json:"total"`
	TotalPages  int64        `json:"total_pages"`
	BrandCounts []BrandCount `json:"brand_counts"`
}

type MerchantsResponse struct {
	Data []Merchant    `json:"data"`
	Meta MerchantsMeta `json:"meta"`
}

func main() {
	// Konfigurasi koneksi database.
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://kopi_user:kopi_local_password@localhost:5432/kopi_keliling?sslmode=disable"
	}

	var err error
	db, err = sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal("Gagal membuka koneksi database:", err)
	}
	defer db.Close()

	// Pastikan database bisa diakses.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Fatal("Gagal terhubung ke PostgreSQL:", err)
	}

	log.Println("Berhasil terhubung ke PostgreSQL")

	// Router HTTP.
	mux := http.NewServeMux()

	// Health check.
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, HealthResponse{
			Status:  "ok",
			Message: "KopiKeliling API is running",
		})
	})

	// Mengambil daftar brand aktif.
	mux.HandleFunc("GET /api/brands", getBrands)

	// Mengambil daftar pedagang.
	mux.HandleFunc("GET /api/merchants", getMerchants)

	// CORS untuk frontend Vite.
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowedOrigins := map[string]bool{
			"http://localhost:5173": true,
			"http://127.0.0.1:5173": true,
		}

		origin := r.Header.Get("Origin")

		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set(
				"Access-Control-Allow-Methods",
				"GET, POST, PUT, PATCH, DELETE, OPTIONS",
			)
			w.Header().Set(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization",
			)
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		mux.ServeHTTP(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("KopiKeliling API berjalan di http://localhost:%s", port)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Gagal menjalankan HTTP server:", err)
	}
}

func getBrands(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(), `
		SELECT id, name, logo_url, is_active
		FROM brands
		WHERE is_active = TRUE
		ORDER BY name ASC
	`)
	if err != nil {
		log.Printf("Gagal mengambil daftar brand: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal mengambil daftar brand",
		})
		return
	}
	defer rows.Close()

	brands := make([]Brand, 0)

	for rows.Next() {
		var brand Brand
		var logoURL sql.NullString

		if err := rows.Scan(
			&brand.ID,
			&brand.Name,
			&logoURL,
			&brand.IsActive,
		); err != nil {
			log.Printf("Gagal membaca data brand: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Gagal membaca data brand",
			})
			return
		}

		if logoURL.Valid {
			brand.LogoURL = &logoURL.String
		}

		brands = append(brands, brand)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Gagal membaca hasil query brand: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal membaca data brand",
		})
		return
	}

	writeJSON(w, http.StatusOK, brands)
}

func getMerchants(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	page, err := parsePaginationParam(query.Get("page"), 1)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Parameter 'page' harus angka bulat positif",
		})
		return
	}

	limit, err := parsePaginationParam(
		query.Get("limit"),
		defaultMerchantsPerPage,
	)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Parameter 'limit' harus angka bulat positif",
		})
		return
	}

	if limit > maxMerchantsPerPage {
		limit = maxMerchantsPerPage
	}

	brand := strings.TrimSpace(query.Get("brand"))

	// Koordinat pengguna bersifat opsional; bila dikirim, hasil diurutkan
	// dari pedagang yang paling dekat.
	var (
		userLatitude    float64
		userLongitude   float64
		hasUserLocation bool
	)

	rawLatitude := strings.TrimSpace(query.Get("latitude"))
	rawLongitude := strings.TrimSpace(query.Get("longitude"))

	if rawLatitude != "" || rawLongitude != "" {
		latitude, errLatitude := strconv.ParseFloat(rawLatitude, 64)
		longitude, errLongitude := strconv.ParseFloat(rawLongitude, 64)

		if errLatitude != nil || errLongitude != nil ||
			latitude < -90 || latitude > 90 ||
			longitude < -180 || longitude > 180 {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "Parameter 'latitude' dan 'longitude' harus koordinat yang valid",
			})
			return
		}

		userLatitude = latitude
		userLongitude = longitude
		hasUserLocation = true
	}

	// Filter dasar mengikuti kebutuhan aplikasi: hanya pedagang dari
	// pengguna aktif, brand aktif, sedang berjualan, dan punya koordinat
	// untuk ditampilkan di peta.
	where := `u.is_active = TRUE
		  AND b.is_active = TRUE
		  AND m.is_available = TRUE
		  AND m.location IS NOT NULL`

	args := []any{}

	if brand != "" {
		args = append(args, brand)
		where += fmt.Sprintf(" AND b.name = $%d", len(args))
	}

	var total int64

	if err := db.QueryRowContext(
		r.Context(),
		fmt.Sprintf(`
			SELECT COUNT(*)
			FROM merchants m
			JOIN users u ON u.id = m.user_id
			JOIN brands b ON b.id = m.brand_id
			WHERE %s
		`, where),
		args...,
	).Scan(&total); err != nil {
		log.Printf("Gagal menghitung jumlah pedagang: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal mengambil data pedagang",
		})
		return
	}

	orderBy := "m.id ASC"

	if hasUserLocation {
		args = append(args, userLongitude, userLatitude)
		orderBy = fmt.Sprintf(
			"m.location <-> ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography ASC",
			len(args)-1,
			len(args),
		)
	}

	offset := (page - 1) * limit
	args = append(args, limit, offset)

	rows, err := db.QueryContext(
		r.Context(),
		fmt.Sprintf(`
			SELECT
				m.id,
				m.merchant_name,
				b.id AS brand_id,
				b.name AS brand_name,
				m.phone,
				ST_Y(m.location::geometry) AS latitude,
				ST_X(m.location::geometry) AS longitude,
				m.is_available
			FROM merchants m
			JOIN users u ON u.id = m.user_id
			JOIN brands b ON b.id = m.brand_id
			WHERE %s
			ORDER BY %s
			LIMIT $%d OFFSET $%d
		`, where, orderBy, len(args)-1, len(args)),
		args...,
	)
	if err != nil {
		log.Printf("Gagal mengambil daftar pedagang: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal mengambil data pedagang",
		})
		return
	}
	defer rows.Close()

	merchants := make([]Merchant, 0)

	for rows.Next() {
		var merchant Merchant
		var phone sql.NullString
		var latitude sql.NullFloat64
		var longitude sql.NullFloat64

		if err := rows.Scan(
			&merchant.ID,
			&merchant.MerchantName,
			&merchant.BrandID,
			&merchant.BrandName,
			&phone,
			&latitude,
			&longitude,
			&merchant.IsAvailable,
		); err != nil {
			log.Printf("Gagal membaca data pedagang: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Gagal membaca data pedagang",
			})
			return
		}

		if phone.Valid {
			merchant.Phone = &phone.String
		}

		if latitude.Valid {
			merchant.Latitude = &latitude.Float64
		}

		if longitude.Valid {
			merchant.Longitude = &longitude.Float64
		}

		merchants = append(merchants, merchant)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Gagal membaca hasil query pedagang: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal membaca data pedagang",
		})
		return
	}

	// Jumlah pedagang aktif per brand untuk opsi filter di frontend.
	brandCounts := make([]BrandCount, 0)

	countRows, err := db.QueryContext(r.Context(), `
		SELECT b.name, COUNT(*)
		FROM merchants m
		JOIN users u ON u.id = m.user_id
		JOIN brands b ON b.id = m.brand_id
		WHERE u.is_active = TRUE
		  AND b.is_active = TRUE
		  AND m.is_available = TRUE
		  AND m.location IS NOT NULL
		GROUP BY b.name
		ORDER BY b.name ASC
	`)
	if err != nil {
		log.Printf("Gagal menghitung jumlah pedagang per brand: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal mengambil data pedagang",
		})
		return
	}
	defer countRows.Close()

	for countRows.Next() {
		var brandCount BrandCount

		if err := countRows.Scan(
			&brandCount.BrandName,
			&brandCount.Count,
		); err != nil {
			log.Printf("Gagal membaca data jumlah brand: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Gagal membaca data pedagang",
			})
			return
		}

		brandCounts = append(brandCounts, brandCount)
	}

	if err := countRows.Err(); err != nil {
		log.Printf("Gagal membaca hasil query jumlah brand: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Gagal membaca data pedagang",
		})
		return
	}

	writeJSON(w, http.StatusOK, MerchantsResponse{
		Data: merchants,
		Meta: MerchantsMeta{
			Page:        page,
			Limit:       limit,
			Total:       total,
			TotalPages:  (total + limit - 1) / limit,
			BrandCounts: brandCounts,
		},
	})
}

// parsePaginationParam membaca parameter pagination. Nilai kosong memakai
// default, selain angka bulat positif ditolak.
func parsePaginationParam(raw string, fallback int64) (int64, error) {
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 1 {
		return 0, fmt.Errorf("nilai tidak valid: %q", raw)
	}

	return value, nil
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Gagal mengirim JSON response: %v", err)
	}
}
