package main

// Bagian ini menangani sisi pedagang: masuk lewat akun Google, sesi login,
// melengkapi profil toko, serta memperbarui dan menutup titik berjualan.

import (
	"context"
	"crypto/rsa"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Lamanya sesi login pedagang sebelum token perlu didapat ulang.
const sessionTokenLifetime = 30 * 24 * time.Hour

// Titik jualan dianggap basi setelah dua jam tanpa pembaruan lokasi.
const availabilityTTL = 2 * time.Hour

const googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// googleJWKSPayload memetakan bentuk dokumen JWKS milik Google.
type googleJWKSPayload struct {
	Keys []googleJWK `json:"keys"`
}

// googleJWK adalah satu kunci publik RSA di dalam JWKS.
type googleJWK struct {
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// Kunci publik Google di-cache: tiap login tidak perlu mengunduh ulang.
var (
	googleKeysMu sync.Mutex
	googleKeys   map[string]*rsa.PublicKey
	googleKeysAt time.Time
)

type authUser struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	AvatarURL *string `json:"avatar_url"`
}

type merchantProfile struct {
	ID                int64      `json:"id"`
	MerchantName      string     `json:"merchant_name"`
	Phone             *string    `json:"phone"`
	BrandID           int64      `json:"brand_id"`
	BrandName         string     `json:"brand_name"`
	Latitude          *float64   `json:"latitude"`
	Longitude         *float64   `json:"longitude"`
	IsAvailable       bool       `json:"is_available"`
	LocationUpdatedAt *time.Time `json:"location_updated_at"`
}

type authResponse struct {
	Token       string           `json:"token"`
	ExpiresAt   time.Time        `json:"expires_at"`
	User        authUser         `json:"user"`
	Merchant    *merchantProfile `json:"merchant"`
	NeedsProfil bool             `json:"needs_profile"`
}

type profileResponse struct {
	User     authUser         `json:"user"`
	Merchant *merchantProfile `json:"merchant"`
}

// loadDotEnv membaca file berformat KEY=value baris per baris dan
// mengisinya ke environment proses, tetapi variabel yang sudah tertera di
// sistem tetap menang sehingga pecahkan berkas ini jadi jalannya default
// komputer, bukan larangan yang kuat.
func loadDotEnv(paths ...string) {
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			// File tidak ada berarti berjalan tanpa berkas ini; sah.
			continue
		}

		for _, line := range strings.Split(string(content), "\n") {
			line = strings.TrimSpace(line)

			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			line = strings.TrimPrefix(line, "export ")

			key, value, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}

			key = strings.TrimSpace(key)
			value = strings.Trim(strings.TrimSpace(value), `"'`)

			if key == "" || value == "" {
				continue
			}

			if _, sudahAda := os.LookupEnv(key); sudahAda {
				continue
			}

			if err := os.Setenv(key, value); err != nil {
				log.Printf("Gagal mengisi %s dari %s: %v", key, path, err)
			}
		}

		log.Printf("Environment dibaca dari %s", path)
	}
}

func googleClientID() string {
	return strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
}

func authSecret() string {
	secret := strings.TrimSpace(os.Getenv("AUTH_JWT_SECRET"))

	if secret == "" {
		log.Println("PERINGATAN: AUTH_JWT_SECRET belum diisi, memakai rahasia pengembangan. Setel variabel ini sebelum dipakai sungguhan.")

		return "kopi-keliling-dev-secret-ganti-di-produksi"
	}

	return secret
}

func newGooglePubKey(jwk googleJWK) (*rsa.PublicKey, error) {
	modulus, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("modulus kunci %s tidak terbaca: %w", jwk.Kid, err)
	}

	exponent, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("eksponen kunci %s tidak terbaca: %w", jwk.Kid, err)
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(modulus),
		E: int(new(big.Int).SetBytes(exponent).Int64()),
	}, nil
}

// fetchGoogleKeys mengunduh dokumen JWKS Google dan memetakan kid ke
// kunci publik RSA, mirip pengecekan sertifikat saat TLS.
func fetchGoogleKeys(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, googleJWKSURL, nil)
	if err != nil {
		return nil, err
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS Google merespons %d", response.StatusCode)
	}

	var payload googleJWKSPayload

	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}

	keys := make(map[string]*rsa.PublicKey, len(payload.Keys))

	for _, jwk := range payload.Keys {
		pubKey, err := newGooglePubKey(jwk)
		if err != nil {
			return nil, err
		}

		keys[jwk.Kid] = pubKey
	}

	return keys, nil
}

// googleKeysFor mengembalikan kunci untuk sebuah kid. Cache diunduh ulang
// bila masih kosong, harus tua, atau kid-nya belum dikenal (rotasi kunci).
func googleKeysFor(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	googleKeysMu.Lock()
	defer googleKeysMu.Unlock()

	known := googleKeys != nil
	stale := time.Since(googleKeysAt) > 12*time.Hour
	unrecognized := known && googleKeys[kid] == nil

	if !known || stale || unrecognized {
		keys, err := fetchGoogleKeys(ctx)
		if err != nil {
			// Cache lama tetap dipakai bila JWKS sekejap gagal diunduh.
			log.Printf("Peringatan: JWKS Google tidak terunduh: %v", err)
		} else {
			googleKeys = keys
			googleKeysAt = time.Now()
		}
	}

	if googleKeys == nil || googleKeys[kid] == nil {
		return nil, fmt.Errorf("kunci id_token dengan kid %q tidak dikenal", kid)
	}

	return googleKeys[kid], nil
}

// verifyGoogleIDToken memastikan id_token benar ditandatangani Google,
// ditujukan untuk aplikasi ini, dari penerbit resmi, dan masih berlaku.
func verifyGoogleIDToken(ctx context.Context, rawIDToken string) (jwt.MapClaims, error) {
	clientID := googleClientID()

	if clientID == "" {
		return nil, errors.New("server belum membawa GOOGLE_CLIENT_ID; setel nilainya di backend/.env lalu jalankan ulang backend")
	}

	claims := jwt.MapClaims{}

	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithAudience(clientID),
		jwt.WithLeeway(2*time.Minute),
	)

	token, err := parser.ParseWithClaims(rawIDToken, claims, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, errors.New("header id_token tanpa kid")
		}

		return googleKeysFor(ctx, kid)
	})
	if err != nil || !token.Valid {
		return nil, errors.New("id_token tidak sah")
	}

	issuer := claims["iss"]
	if issuer != "accounts.google.com" && issuer != "https://accounts.google.com" {
		return nil, errors.New("id_token bukan dari penerbit Google")
	}

	return claims, nil
}

// stringClaim membaca klaim yang bisa berupa teks maupun angka.
func stringClaim(claims jwt.MapClaims, key string) string {
	switch value := claims[key].(type) {
	case string:
		return value
	default:
		return ""
	}
}

// boolClaim membaca klaim bertanda benar/salah, termasuk versi teksnya.
func boolClaim(claims jwt.MapClaims, key string) bool {
	switch value := claims[key].(type) {
	case bool:
		return value
	case string:
		return value == "true"
	default:
		return false
	}
}

// decodeJSONBody membaca isi request JSON dengan batas ukuran agar server
// tidak bisa dibebani payload raksasa.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, target any) error {
	body := http.MaxBytesReader(w, r.Body, 1<<20)

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()

	return decoder.Decode(target)
}

func respondError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")

	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}

	return strings.TrimSpace(header[len(prefix):])
}

// findUserByID mengembalikan akun dari database; nil bila tidak ada.
func findUserByID(ctx context.Context, id int64) (*authUser, error) {
	var user authUser
	var avatarURL sql.NullString

	err := db.QueryRowContext(ctx, `
		SELECT id, name, email, role, avatar_url
		FROM users
		WHERE id = $1
	`, id).Scan(&user.ID, &user.Name, &user.Email, &user.Role, &avatarURL)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}

		return nil, err
	}

	if avatarURL.Valid && avatarURL.String != "" {
		user.AvatarURL = &avatarURL.String
	}

	return &user, nil
}

// userFromRequest mengembalikan pedagang pemilik token sesi. Tidak ok bila
// token hilang, tidak sah, sudah beku, atau akun nonaktif.
func userFromRequest(r *http.Request) (*authUser, bool) {
	raw := bearerToken(r)
	if raw == "" {
		return nil, false
	}

	claims := jwt.RegisteredClaims{}

	token, err := jwt.NewParser(
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithLeeway(time.Minute),
	).ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) {
		return []byte(authSecret()), nil
	})
	if err != nil || !token.Valid || claims.Subject == "" {
		return nil, false
	}

	userID, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return nil, false
	}

	user, err := findUserByID(r.Context(), userID)
	if err != nil || user == nil || user.Role != "merchant" {
		return nil, false
	}

	return user, true
}

// createSessionToken membuat token sesi yang bertanda tangan server.
func createSessionToken(user *authUser) (string, time.Time) {
	now := time.Now()
	expiresAt := now.Add(sessionTokenLifetime)

	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(user.ID, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
	}

	token, err := jwt.NewWithClaims(
		jwt.SigningMethodHS256,
		claims,
	).SignedString([]byte(authSecret()))
	if err != nil {
		// Gagal menandatangani berarti rahasia tidak bisa dibaca; lebih
		// tegas berhenti daripada mengirim token palsu.
		log.Fatal("Gagal membuat token sesi:", err)
	}

	return token, expiresAt
}

// scanMerchantProfile membaca satu baris profil toko dari hasil query.
func scanMerchantProfile(scanner interface {
	Scan(dest ...any) error
}) (*merchantProfile, error) {
	var profile merchantProfile
	var phone sql.NullString
	var latitude sql.NullFloat64
	var longitude sql.NullFloat64
	var locationUpdatedAt sql.NullTime

	err := scanner.Scan(
		&profile.ID,
		&profile.MerchantName,
		&phone,
		&profile.BrandID,
		&profile.BrandName,
		&latitude,
		&longitude,
		&profile.IsAvailable,
		&locationUpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if phone.Valid {
		profile.Phone = &phone.String
	}

	if latitude.Valid {
		profile.Latitude = &latitude.Float64
	}

	if longitude.Valid {
		profile.Longitude = &longitude.Float64
	}

	if locationUpdatedAt.Valid {
		updatedAt := locationUpdatedAt.Time
		profile.LocationUpdatedAt = &updatedAt
	}

	return &profile, nil
}

// merchantProfileForUser mengambil profil toko seorang pedagang; nil bila
// akunnya belum melengkapi profil sama sekali.
func merchantProfileForUser(ctx context.Context, userID int64) (*merchantProfile, error) {
	profile, err := scanMerchantProfile(db.QueryRowContext(ctx, `
		SELECT
			m.id,
			m.merchant_name,
			m.phone,
			b.id,
			b.name,
			ST_Y(m.location::geometry),
			ST_X(m.location::geometry),
			m.is_available,
			m.location_updated_at
		FROM merchants m
		JOIN brands b ON b.id = m.brand_id
		WHERE m.user_id = $1
	`, userID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}

		return nil, err
	}

	return profile, nil
}

// postAuthGoogle menerima id_token dari tombol Masuk Google, memastikan
// sahnya, lalu menautkan atau membuat akun pedagang dan balik token sesi.
func postAuthGoogle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDToken string `json:"id_token"`
	}

	if err := decodeJSONBody(w, r, &body); err != nil {
		respondError(w, http.StatusBadRequest, "Permintaan tidak terbaca; kirim JSON dengan kolom id_token")
		return
	}

	rawIDToken := strings.TrimSpace(body.IDToken)
	if rawIDToken == "" {
		respondError(w, http.StatusBadRequest, "id_token wajib diisi")
		return
	}

	claims, err := verifyGoogleIDToken(r.Context(), rawIDToken)
	if err != nil {
		log.Printf("id_token Google ditolak: %v", err)
		respondError(w, http.StatusUnauthorized, "Bukti masuk Google tidak sah")
		return
	}

	if !boolClaim(claims, "email_verified") {
		respondError(w, http.StatusUnauthorized, "Email Google belum terverifikasi")
		return
	}

	googleID := stringClaim(claims, "sub")
	email := strings.ToLower(stringClaim(claims, "email"))
	name := strings.TrimSpace(stringClaim(claims, "name"))
	avatarURL := stringClaim(claims, "picture")

	if googleID == "" || email == "" {
		respondError(w, http.StatusUnauthorized, "id_token tidak memuat identitas yang lengkap")
		return
	}

	if name == "" {
		// Nama tampilan memakai bagian sebelum @ bila Google tidak kirim.
		name = email[:strings.Index(email, "@")]
	}

	var accountID int64
	var accountName, accountEmail, accountRole string
	var accountAvatar sql.NullString

	err = db.QueryRowContext(r.Context(), `
		SELECT id, name, email, role, avatar_url
		FROM users
		WHERE google_id = $1
	`, googleID).Scan(
		&accountID, &accountName, &accountEmail, &accountRole, &accountAvatar,
	)

	if errors.Is(err, sql.ErrNoRows) {
		err = db.QueryRowContext(r.Context(), `
			INSERT INTO users (name, email, provider, google_id, avatar_url, role)
			VALUES ($1, $2, 'google', $3, $4, 'merchant')
			ON CONFLICT (email) DO UPDATE SET
				name = EXCLUDED.name,
				provider = 'google',
				google_id = EXCLUDED.google_id,
				avatar_url = EXCLUDED.avatar_url,
				updated_at = NOW()
			RETURNING id, name, email, role, avatar_url
		`, name, email, googleID, avatarURL).Scan(
			&accountID, &accountName, &accountEmail, &accountRole, &accountAvatar,
		)
	}

	if err != nil {
		log.Printf("Gagal menaut akun Google: %v", err)
		respondError(w, http.StatusInternalServerError, "Akun Google tidak bisa ditautkan")
		return
	}

	if accountRole != "merchant" {
		respondError(w, http.StatusForbidden, "Masuk Google hanya untuk pedagang")
		return
	}

	user := &authUser{
		ID:    accountID,
		Name:  accountName,
		Email: accountEmail,
		Role:  accountRole,
	}
	if accountAvatar.Valid && accountAvatar.String != "" {
		user.AvatarURL = &accountAvatar.String
	}

	token, expiresAt := createSessionToken(user)

	profile, err := merchantProfileForUser(r.Context(), user.ID)
	if err != nil {
		log.Printf("Gagal membaca profil pedagang: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil pedagang tidak bisa dibaca")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		Token:       token,
		ExpiresAt:   expiresAt,
		User:        *user,
		Merchant:    profile,
		NeedsProfil: profile == nil,
	})
}

// getAuthMe membaca ulang profil akun pedagang dari token sesi; dipakai
// frontend untuk tahu harus masuk, melengkapi profil, atau ke dasbor.
func getAuthMe(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromRequest(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "Sesi tidak terbaca; masuk terlebih dulu")
		return
	}

	profile, err := merchantProfileForUser(r.Context(), user.ID)
	if err != nil {
		log.Printf("Gagal membaca profil pedagang: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil pedagang tidak bisa dibaca")
		return
	}

	writeJSON(w, http.StatusOK, profileResponse{
		User:     *user,
		Merchant: profile,
	})
}

// postMerchantProfile menyimpan atau memperbarui profil toko pedagang.
func postMerchantProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromRequest(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "Sesi tidak terbaca; masuk terlebih dulu")
		return
	}

	var body struct {
		MerchantName string  `json:"merchant_name"`
		Phone        *string `json:"phone"`
		BrandID      int64   `json:"brand_id"`
	}

	if err := decodeJSONBody(w, r, &body); err != nil {
		respondError(w, http.StatusBadRequest, "Permintaan tidak terbaca; kirim profil dalam JSON")
		return
	}

	merchantName := strings.TrimSpace(body.MerchantName)
	if merchantName == "" || len(merchantName) > 150 {
		respondError(w, http.StatusBadRequest, "Nama toko wajib diisi, maksimal 150 karakter")
		return
	}

	phone := ""
	if body.Phone != nil {
		phone = strings.TrimSpace(*body.Phone)

		if len(phone) > 30 {
			respondError(w, http.StatusBadRequest, "Nomor telepon maksimal 30 karakter")
			return
		}
	}

	var brandExists bool

	err := db.QueryRowContext(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM brands WHERE id = $1 AND is_active = TRUE)
	`, body.BrandID).Scan(&brandExists)
	if err != nil || !brandExists {
		respondError(w, http.StatusBadRequest, "Brand tidak dikenal; pilih dari daftar")
		return
	}

	phoneValue := sql.NullString{}
	if phone != "" {
		phoneValue = sql.NullString{String: phone, Valid: true}
	}

	_, err = db.ExecContext(r.Context(), `
		INSERT INTO merchants (user_id, brand_id, merchant_name, phone)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
			brand_id = EXCLUDED.brand_id,
			merchant_name = EXCLUDED.merchant_name,
			phone = EXCLUDED.phone,
			updated_at = NOW()
	`, user.ID, body.BrandID, merchantName, phoneValue)
	if err != nil {
		log.Printf("Gagal menyimpan profil toko: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil toko tidak bisa disimpan")
		return
	}

	profile, err := merchantProfileForUser(r.Context(), user.ID)
	if err != nil {
		log.Printf("Gagal membaca profil pedagang: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil pedagang tidak bisa dibaca")
		return
	}

	writeJSON(w, http.StatusOK, profileResponse{
		User:     *user,
		Merchant: profile,
	})
}

// postMerchantLocation menyimpan titik berjualan terbaru dan menandai
// pedagang sebagai sedang berjualan.
func postMerchantLocation(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromRequest(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "Sesi tidak terbaca; masuk terlebih dulu")
		return
	}

	var body struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	}

	if err := decodeJSONBody(w, r, &body); err != nil {
		respondError(w, http.StatusBadRequest, "Permintaan tidak terbaca; kirim koordinat dalam JSON")
		return
	}

	if body.Latitude < -90 || body.Latitude > 90 ||
		body.Longitude < -180 || body.Longitude > 180 {
		respondError(w, http.StatusBadRequest, "Koordinat tidak valid")
		return
	}

	result, err := db.ExecContext(r.Context(), `
		UPDATE merchants SET
			location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			is_available = TRUE,
			location_updated_at = NOW(),
			updated_at = NOW()
		WHERE user_id = $1
	`, user.ID, body.Longitude, body.Latitude)
	if err != nil {
		log.Printf("Gagal memperbarui lokasi: %v", err)
		respondError(w, http.StatusInternalServerError, "Lokasi tidak bisa disimpan")
		return
	}

	if affected, _ := result.RowsAffected(); affected == 0 {
		respondError(w, http.StatusConflict, "Profil toko belum lengkap; isi profil terlebih dulu")
		return
	}

	profile, err := merchantProfileForUser(r.Context(), user.ID)
	if err != nil {
		log.Printf("Gagal membaca profil pedagang: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil pedagang tidak bisa dibaca")
		return
	}

	writeJSON(w, http.StatusOK, profileResponse{
		User:     *user,
		Merchant: profile,
	})
}

// deleteMerchantLocation menandai pedagang sudah tutup berjualan. Titik
// terakhir tetap disimpan, tetapi tidak tampil di peta konsumen.
func deleteMerchantLocation(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromRequest(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "Sesi tidak terbaca; masuk terlebih dulu")
		return
	}

	if _, err := db.ExecContext(r.Context(), `
		UPDATE merchants SET
			is_available = FALSE,
			updated_at = NOW()
		WHERE user_id = $1
	`, user.ID); err != nil {
		log.Printf("Gagal menutup titik jualan: %v", err)
		respondError(w, http.StatusInternalServerError, "Titik jualan tidak bisa ditutup")
		return
	}

	profile, err := merchantProfileForUser(r.Context(), user.ID)
	if err != nil {
		log.Printf("Gagal membaca profil pedagang: %v", err)
		respondError(w, http.StatusInternalServerError, "Profil pedagang tidak bisa dibaca")
		return
	}

	writeJSON(w, http.StatusOK, profileResponse{
		User:     *user,
		Merchant: profile,
	})
}
