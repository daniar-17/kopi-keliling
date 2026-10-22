
-- Mengaktifkan fitur geografis PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Akun admin dan pedagang.
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'merchant'
        CHECK (role IN ('admin', 'merchant')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daftar brand yang dikelola admin.
CREATE TABLE brands (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profil pedagang kopi keliling.
CREATE TABLE merchants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
    brand_id BIGINT NOT NULL REFERENCES brands(id),
    merchant_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    location GEOGRAPHY(POINT, 4326),
    location_updated_at TIMESTAMPTZ,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mempercepat pencarian pedagang berdasarkan jarak.
CREATE INDEX merchants_location_gix
    ON merchants USING GIST (location);

-- Mempercepat filter pedagang yang sedang berjualan.
CREATE INDEX merchants_available_idx
    ON merchants (is_available);
