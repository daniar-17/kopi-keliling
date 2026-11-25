// Titik koleksi akses API dan kredensial sesi pedagang.

// Di production, alamat backend diisi lewat VITE_API_BASE_URL saat build
// (misalnya https://kopi-keliling-api.onrender.com). Tanpa nilai itu,
// backend mengikuti hostname tempat halaman dibuka supaya aplikasi tetap
// berjalan saat diakses dari perangkat lain di jaringan yang sama.
const fallbackBaseURL = `http://${window.location.hostname}:8080`

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || fallbackBaseURL
).replace(/\/+$/, '')

const SESSION_STORAGE_KEY = 'kopikeliling_session'

export function readSessionToken(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY)
}

export function saveSessionToken(token: string) {
  localStorage.setItem(SESSION_STORAGE_KEY, token)
}

export function clearSessionToken() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}
