/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Alamat API saat build production, misalnya
  // https://kopi-keliling-api.onrender.com. Kosongkan saat pengembangan
  // supaya frontend memakai http://<hostname>:8080.
  readonly VITE_API_BASE_URL?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
}
