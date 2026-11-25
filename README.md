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
Biarkan `VITE_API_BASE_URL` kosong saat pengembangan; frontend akan
memakai `http://<hostname>:8080` secara otomatis (termasuk saat dibuka dari
HP).

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

## Deploy gratis (Vercel + Render + Neon)

Urutannya: database → backend → frontend → izin CORS dan OAuth.

### Neon

1. Buat project di region **Singapore**, lalu pastikan PostGIS tersedia:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

2. Ambil **direct connection string** (bukan yang `-pooler`) dan tambahkan
   `?sslmode=require`.
3. Terapkan migrasi berurutan:

   ```bash
   NEON_URL="postgres://...@....neon.tech/kopi_keliling?sslmode=require"
   psql "$NEON_URL" -f backend/migrations/001_init.sql
   psql "$NEON_URL" -f backend/migrations/002_google_auth.sql
   psql "$NEON_URL" -f backend/migrations/003_brand_marker_colors.sql
   psql "$NEON_URL" -c "SELECT postgis_version();"
   ```

4. Tambahkan minimal satu brand, karena pedagang wajib memilih brand saat
   mendaftar:

   ```bash
   psql "$NEON_URL" -c "INSERT INTO brands (name) VALUES ('Kopi') ON CONFLICT (name) DO NOTHING;"
   ```

Untuk aplikasi dengan data nyata, jangan jalankan `demo_merchants.sql`; seed
itu hanya untuk demo dan pengembangan (termasuk demo portofolio di bawah).

### Render

Buat **Web Service** dari repo ini dengan konfigurasi:

- Root directory: `backend`, runtime Go, region Singapore, plan Free.
- Build command: `go build -o app .`
- Start command: `./app`
- Health check path: `/health`

Environment yang perlu diisi:

| Variabel | Nilai |
| --- | --- |
| `DATABASE_URL` | connection string Neon |
| `GOOGLE_CLIENT_ID` | klien OAuth yang sama dengan frontend |
| `AUTH_JWT_SECRET` | teks acak panjang, mis. `openssl rand -hex 32` |
| `CORS_ORIGINS` | alamat Vercel, mis. `https://kopi-keliling.vercel.app` |

`PORT` diisi otomatis oleh Render.

### Vercel

Import repo yang sama, lalu:

- Root directory: `frontend`, framework Vite (terdeteksi otomatis).
- Environment **Production**: `VITE_API_BASE_URL` (alamat Render, tanpa
  garis miring di akhir) dan `VITE_GOOGLE_CLIENT_ID`.
- Deploy. Nilai env Vite ikut terkunci saat build, jadi setiap perubahan
  perlu redeploy.

Setelah URL Vercel diketahui, perbarui `CORS_ORIGINS` di Render dan
tambahkan URL tersebut ke **Authorized JavaScript origins** Google. Jika
OAuth consent screen masih berstatus *Testing*, hanya test user yang bisa
masuk; publish ke Production agar publik dapat login.

### Data demo yang selalu segar

Titik pedagang basi setelah 2 jam. Untuk demo publik, simpan connection
string Neon sebagai repository secret `NEON_DATABASE_URL`; alur
`.github/workflows/seed-demo.yml` akan menjalankan ulang seed tiap jam.

### Batasan free tier

Render mematikan service setelah ±15 menit tanpa trafik, sehingga request
pertama bisa tertunda 30–60 detik. Neon juga menangguhkan compute saat
menganggur, tetapi biasanya hanya menambah sekitar satu detik.

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `Gagal terhubung ke PostgreSQL: role "kopi_user" does not exist` | Role/DB belum dibuat — jalankan langkah 1. |
| `column "marker_colors" does not exist` | Migrasi `003_brand_marker_colors.sql` belum diterapkan. |
| `Cannot connect to the Docker daemon` | Docker Desktop belum menyala. |
| Frontend tampil tapi data kosong | Backend belum jalan atau `GOOGLE_CLIENT_ID`/brand belum diisi. |
| Tombol masuk Google tidak muncul | `VITE_GOOGLE_CLIENT_ID` kosong atau origin belum terdaftar di Google Cloud Console. |
| Request diblokir CORS di production | Alamat Vercel belum tercantum di `CORS_ORIGINS` backend. |
| Logo brand hilang di halaman HTTPS | Backend tidak menerima `X-Forwarded-Proto`, atau URL logo masih `http://`. |
| Peta kosong setelah ±2 jam | Titik pedagang sudah basi (`availabilityTTL`) — jalankan ulang seed. |
