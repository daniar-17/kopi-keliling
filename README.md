# Kopi Keliling

Peta pedagang kopi keliling: konsumen melihat titik pedagang yang sedang
berjualan, pedagang mengelola lokasinya lewat login Google.

- `backend/` — API Go (net/http + pgx), migrasi SQL, dan seed data contoh.
- `frontend/` — React + Vite + Tailwind + Leaflet.
- `docker-compose.yml` — PostgreSQL 17 + PostGIS untuk pengembangan.

## Tema

Antarmuka memakai gaya neobrutalism dengan susunan bento: border tinta tebal,
bayangan keras tanpa blur, sudut membulat, dan palet putih, hijau, serta
mustard. Arah desain, palet, dan alasan tiap keputusan ada di `DESIGN.md`. Token warna, font, dan bayangan
berada di `frontend/src/index.css`.

## Prasyarat

- Go 1.25+
- Node.js 20+
- PostgreSQL dengan ekstensi **PostGIS** (lewat Docker, atau Postgres.app)

## 1. Siapkan database

### Opsi A — Docker (paling mudah bila Docker aktif)

```bash
docker compose up -d db
docker exec -i kopi-keliling-db \
  psql -U kopi_user -d kopi_keliling < backend/migrations/001_init.sql
docker exec -i kopi-keliling-db \
  psql -U kopi_user -d kopi_keliling < backend/migrations/002_google_auth.sql
docker exec -i kopi-keliling-db \
  psql -U kopi_user -d kopi_keliling < backend/migrations/003_brand_marker_colors.sql
```

### Opsi B — PostgreSQL/PostGIS yang sudah terpasang

```bash
psql -d postgres -c "CREATE ROLE kopi_user LOGIN PASSWORD 'kopi_local_password';"
psql -d postgres -c "CREATE DATABASE kopi_keliling OWNER kopi_user;"

# PostGIS butuh superuser, jadi dibuat lebih dulu.
psql -d kopi_keliling -c "CREATE EXTENSION IF NOT EXISTS postgis;"

DB="postgres://kopi_user:kopi_local_password@localhost:5432/kopi_keliling?sslmode=disable"
psql "$DB" -f backend/migrations/001_init.sql
psql "$DB" -f backend/migrations/002_google_auth.sql
psql "$DB" -f backend/migrations/003_brand_marker_colors.sql
```

> Jika port 5432 sudah dipakai PostgreSQL lokal, hentikan dulu servisnya
> sebelum memakai Docker, atau ubah pemetaan port di `docker-compose.yml`.

### Data contoh (opsional, agar peta dan halaman pedagang terisi)

```bash
psql "$DB" -f backend/seeds/demo_merchants.sql
```

Membuat 3 brand dan 8 pedagang contoh di sekitar Jakarta. Untuk Docker:

```bash
docker exec -i kopi-keliling-db \
  psql -U kopi_user -d kopi_keliling < backend/seeds/demo_merchants.sql
```

Berkas seed aman dijalankan berulang (tidak membuat duplikat). Titik
pedagang dianggap basi setelah 2 jam (`availabilityTTL`), jadi jalankan
ulang berkas ini bila titiknya hilang dari peta. Panduan menambah satu
pedagang manual ada di komentar bagian bawah berkas seed.

## 2. Konfigurasi environment

```bash
cp backend/.env.example backend/.env
```

Isi `backend/.env`: `GOOGLE_CLIENT_ID` dan `AUTH_JWT_SECRET` (teks acak
panjang). `DATABASE_URL` boleh dikosongkan bila memakai nilai default di
atas.

```bash
cp frontend/.env.example frontend/.env.local
```

Isi `frontend/.env.local` dengan `VITE_GOOGLE_CLIENT_ID` yang sama.

## 3. Jalankan aplikasi

```bash
# Terminal 1 — API di http://localhost:8080
cd backend && go run .

# Terminal 2 — UI di http://localhost:5173
cd frontend && npm run dev
```

Cek cepat backend:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/brands
```

## Akses dari HP

Vite sudah diekspos ke jaringan (`server.host = true`). Buka
`http://<IP-komputer>:5173` dari HP; frontend otomatis memanggil backend di
`http://<IP-komputer>:8080` karena hostname mengikuti halaman.

## Login Google

Tambahkan origin frontend (`http://localhost:5173` dan, bila perlu,
`http://<IP-komputer>:5173`) ke **Authorized JavaScript origins** pada klien
OAuth tipe *Web* di Google Cloud Console.

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `Gagal terhubung ke PostgreSQL: role "kopi_user" does not exist` | Role/DB belum dibuat — jalankan langkah 1. |
| `column "marker_colors" does not exist` | Migrasi `003_brand_marker_colors.sql` belum diterapkan. |
| `Cannot connect to the Docker daemon` | Docker Desktop belum menyala. |
| Frontend tampil tapi data kosong | Backend belum jalan atau `GOOGLE_CLIENT_ID`/brand belum diisi. |
| Tombol masuk Google tidak muncul | `VITE_GOOGLE_CLIENT_ID` kosong atau origin belum terdaftar di Google Cloud Console. |
