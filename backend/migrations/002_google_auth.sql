
-- Akun Google tidak punya kata sandi, jadi hash boleh kosong.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Sumber identitas akun: password (admin), atau google (pedagang).
ALTER TABLE users ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'password'
    CHECK (provider IN ('password', 'google'));

-- ID akun Google dan foto profil yang dikirim bersama id_token.
ALTER TABLE users ADD COLUMN google_id VARCHAR(50) UNIQUE;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
