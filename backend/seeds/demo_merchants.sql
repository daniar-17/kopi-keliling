-- Data pedagang contoh untuk pengembangan, terkonsentrasi di Jakarta
-- supaya langsung terlihat pada pusat peta bawaan frontend.
--
-- Kategori yang dipakai adalah jenis dagangan (Kopi, Mie Ayam, Bakso, dst.)
-- sehingga tabel brands berperan sebagai kategori pedagang keliling.
--
-- Jalankan:
--   psql "postgres://kopi_user:kopi_local_password@localhost:5432/kopi_keliling?sslmode=disable" \
--     -f backend/seeds/demo_merchants.sql
--
-- Berkas ini aman dijalankan berulang: email dipakai sebagai kunci akun
-- dan user_id sebagai kunci profil pedagang, jadi tidak ada duplikat.
-- Titik pedagang dianggap basi setelah 2 jam (availabilityTTL di backend),
-- jalankan ulang berkas ini untuk menyegarkan location_updated_at.

BEGIN;

-- Kategori pedagang beserta warna marker yang lembut.
INSERT INTO brands (name, marker_colors) VALUES
    ('Kopi',           '#C8A98B'),
    ('Mie Ayam',       '#F2C879'),
    ('Bakso',          '#E8A79E'),
    ('Cilok',          '#A9C9E8'),
    ('Batagor',        '#EFB3C4'),
    ('Nasi Goreng',    '#D9A85F'),
    ('Es Teh',         '#A7D5BE'),
    ('Cilor',          '#F4D06F'),
    ('Seblak',         '#F0A270'),
    ('Nasi Bebek',     '#AD8F6E'),
    ('Makanan Lain',   '#C4BFB7'),
    ('Minuman Lain',   '#B3C3D6')
ON CONFLICT (name) DO UPDATE SET
    marker_colors = EXCLUDED.marker_colors,
    is_active = TRUE,
    updated_at = NOW();

CREATE TEMP TABLE demo_merchants (
    email         TEXT,
    user_name     TEXT,
    brand_name    TEXT,
    merchant_name TEXT,
    phone         TEXT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION
) ON COMMIT DROP;

INSERT INTO demo_merchants
    (email, user_name, brand_name, merchant_name, phone, latitude, longitude)
VALUES
    ('budi@contoh.test',  'Budi Santoso',    'Kopi',          'Kopi Pak Budi',      '081200000001', -6.1754, 106.8272),
    ('sari@contoh.test',  'Sari Wulandari',  'Mie Ayam',      'Mie Ayam Bu Sari',   '081200000002', -6.1862, 106.8230),
    ('andi@contoh.test',  'Andi Pratama',    'Bakso',         'Bakso Pak Andi',     '081200000003', -6.1944, 106.8229),
    ('rina@contoh.test',  'Rina Marlina',    'Cilok',         'Cilok Bu Rina',      '081200000004', -6.2445, 106.8008),
    ('dedi@contoh.test',  'Dedi Kurniawan',  'Batagor',       'Batagor Pak Dedi',   '081200000005', -6.2607, 106.8138),
    ('nia@contoh.test',   'Nia Ramadhani',   'Nasi Goreng',   'Nasi Goreng Bu Nia', '081200000006', -6.2262, 106.8540),
    ('joko@contoh.test',  'Joko Susilo',     'Es Teh',        'Es Teh Pak Joko',    '081200000007', -6.1618, 106.9056),
    ('wati@contoh.test',  'Wati Lestari',    'Cilor',         'Cilor Bu Wati',      '081200000008', -6.3606, 106.8270),
    ('agus@contoh.test',  'Agus Setiawan',   'Seblak',        'Seblak Pak Agus',    '081200000009', -6.2146, 106.8451),
    ('dewi@contoh.test',  'Dewi Anggraini',  'Nasi Bebek',    'Nasi Bebek Bu Dewi', '081200000010', -6.1944, 106.8333),
    ('rudi@contoh.test',  'Rudi Hartono',    'Makanan Lain',  'Lotek Pak Rudi',     '081200000011', -6.2297, 106.8166),
    ('sinta@contoh.test', 'Sinta Maharani',  'Minuman Lain',  'Wedang Bu Sinta',    '081200000012', -6.1751, 106.8650);

-- 1. Akun pedagang. Akun Google tidak memakai kata sandi, jadi
--    password_hash dibiarkan kosong (lihat migrasi 002).
INSERT INTO users (name, email, provider, role)
SELECT user_name, email, 'google', 'merchant'
FROM demo_merchants
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();

-- 2. Profil pedagang beserta titik jualnya.
INSERT INTO merchants (
    user_id,
    brand_id,
    merchant_name,
    phone,
    location,
    location_updated_at,
    is_available
)
SELECT
    u.id,
    b.id,
    d.merchant_name,
    d.phone,
    ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326)::geography,
    NOW(),
    TRUE
FROM demo_merchants d
JOIN users u ON u.email = d.email
JOIN brands b ON b.name = d.brand_name
ON CONFLICT (user_id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    merchant_name = EXCLUDED.merchant_name,
    phone = EXCLUDED.phone,
    location = EXCLUDED.location,
    location_updated_at = EXCLUDED.location_updated_at,
    is_available = EXCLUDED.is_available,
    updated_at = NOW();

-- 3. Brand dari data demo lama tidak dipakai lagi. Dinonaktifkan, bukan
--    dihapus, supaya masih bisa diaktifkan lagi bila diperlukan.
UPDATE brands
SET is_active = FALSE,
    updated_at = NOW()
WHERE name IN ('Kopi Kenangan', 'Janji Jiwa', 'Kopi Tuku');

-- Ringkasan hasil supaya mudah dicek di terminal.
SELECT
    m.id,
    m.merchant_name,
    b.name AS brand,
    b.marker_colors,
    ST_Y(m.location::geometry) AS latitude,
    ST_X(m.location::geometry) AS longitude
FROM merchants m
JOIN brands b ON b.id = m.brand_id
JOIN users u ON u.id = m.user_id
JOIN demo_merchants d ON d.email = u.email
ORDER BY m.id;

COMMIT;

-- ---------------------------------------------------------------------------
-- Menambah satu pedagang sendiri: salin pola di bawah, ganti nilainya, lalu
-- pastikan brand-nya sudah ada di tabel brands.
--
-- INSERT INTO users (name, email, provider, role)
-- VALUES ('Nama Pedagang', 'email@contoh.test', 'google', 'merchant')
-- ON CONFLICT (email) DO NOTHING;
--
-- INSERT INTO merchants (
--     user_id, brand_id, merchant_name, phone,
--     location, location_updated_at, is_available
-- )
-- SELECT u.id, b.id, 'Nama Gerobak', '0812xxxxxxx',
--        ST_SetSRID(ST_MakePoint(106.8272, -6.1754), 4326)::geography,
--        NOW(), TRUE
-- FROM users u, brands b
-- WHERE u.email = 'email@contoh.test' AND b.name = 'Kopi';
-- ---------------------------------------------------------------------------
