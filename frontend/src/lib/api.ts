// Titik koleksi akses API dan kredensial sesi pedagang.

// Backend mengikuti hostname tempat halaman dibuka, supaya aplikasi tetap
// berjalan saat diakses dari perangkat lain (misalnya HP) di jaringan yang
// sama, bukan hanya dari localhost.
export const API_BASE_URL = `http://${window.location.hostname}:8080`

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
