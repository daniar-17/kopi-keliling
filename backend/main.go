package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
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
	rows, err := db.QueryContext(r.Context(), `
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
		WHERE u.is_active = TRUE
		  AND b.is_active = TRUE
		ORDER BY m.id ASC
	`)
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

	writeJSON(w, http.StatusOK, merchants)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Gagal mengirim JSON response: %v", err)
	}
}
