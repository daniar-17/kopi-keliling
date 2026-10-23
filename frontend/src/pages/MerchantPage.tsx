import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ChevronLeft,
  ChevronDown,
  LoaderCircle,
  LocateFixed,
  LogOut,
  Power,
} from 'lucide-react'
import {
  API_BASE_URL,
  authHeaders,
  clearSessionToken,
  readSessionToken,
  saveSessionToken,
} from '../lib/api'
import { formatRelativeTime } from '../lib/format'

// Titik jualan dianggap basi setelah dua jam tanpa pembaruan; angka ini
// mengikuti batas yang diterapkan backend.
const LOCATION_TTL_MINUTES = 120

// Pedagang yang sedang jualan otomatis mengirim titik baru semewaktu,
// selama halaman dasbor masih terbuka.
const AUTO_UPDATE_INTERVAL_MS = 10 * 60 * 1000

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

type GoogleCredentialResponse = {
  credential: string
}

type GoogleIdButtonApi = {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  renderButton(
    parent: HTMLElement,
    options: Record<string, string | number>,
  ): void
}

type GoogleIdApi = {
  accounts: {
    id: GoogleIdButtonApi
  }
}

declare global {
  interface Window {
    google?: GoogleIdApi
  }
}

type ApiUser = {
  id: number
  name: string
  email: string
  role: string
  avatar_url: string | null
}

type ApiMerchantProfile = {
  id: number
  merchant_name: string
  phone: string | null
  brand_id: number
  brand_name: string
  latitude: number | null
  longitude: number | null
  is_available: boolean
  location_updated_at: string | null
}

type ApiAuthResponse = {
  token: string
  expires_at: string
  user: ApiUser
  merchant: ApiMerchantProfile | null
  needs_profile: boolean
}

type ApiProfileResponse = {
  user: ApiUser
  merchant: ApiMerchantProfile | null
}

type Brand = {
  id: number
  name: string
}

type Session = {
  token: string
  user: ApiUser
  merchant: ApiMerchantProfile | null
}

// Empat keadaan layar: memuat, masuk, melengkapi profil, dan dasbor.
type View = 'loading' | 'login' | 'onboarding' | 'dashboard'

// Memuat skrip tombol masuk Google satu kali, lalu memakai ulang apinya.
function loadGoogleIdentity(): Promise<GoogleIdApi> {
  if (window.google?.accounts) {
    return Promise.resolve(window.google)
  }

  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      'script[data-gsi="true"]',
    )

    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.gsi = 'true'
      document.head.appendChild(script)
    }

    script.addEventListener(
      'load',
      () => {
        if (window.google?.accounts) {
          resolve(window.google)
        } else {
          reject(new Error('Skrip Google tidak lengkap'))
        }
      },
      { once: true },
    )

    script.addEventListener(
      'error',
      () => reject(new Error('Skrip Google gagal diunduh')),
      { once: true },
    )
  })
}

function MerchantPage() {
  // Ada token tersimpan berarti sesi perlu diperiksa dulu ke backend.
  const [view, setView] = useState<View>(() =>
    readSessionToken() ? 'loading' : 'login',
  )
  const [session, setSession] = useState<Session | null>(null)

  // Pesan kecil di bawah setiap aksi; selalu berisi sebab & tindak lanjut.
  const [notice, setNotice] = useState('')

  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  const [brandOptions, setBrandOptions] = useState<Brand[]>([])
  const [isLoadingBrands, setIsLoadingBrands] = useState(false)
  const [brandError, setBrandError] = useState('')

  // Isian form profil; diberi nilai awal dari nama akun Google.
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formBrandId, setFormBrandId] = useState('')

  // Dicicil tiap setengah menit supaya label "x lalu" ikut beranjak.
  const [now, setNow] = useState(() => Date.now())

  const googleButtonRef = useRef<HTMLDivElement>(null)
  const credentialHandlerRef = useRef<(credential: string) => void>(
    () => {},
  )

  // Pemeriksaan sesi tersimpan saat halaman dibuka; tanpa token, layar
  // masuk sudah jadi nilai awal state sehingga effect ini tak menyetel.
  useEffect(function checkStoredSession() {
    const token = readSessionToken()

    if (!token) {
      return
    }

    fetch(`${API_BASE_URL}/api/auth/me`, { headers: authHeaders(token) })
      .then(async (response) => {
        if (response.status === 401) {
          clearSessionToken()
          setView('login')
          return
        }

        if (!response.ok) {
          throw new Error('Gagal membaca sesi')
        }

        const payload: ApiProfileResponse = await response.json()

        setSession({ token, user: payload.user, merchant: payload.merchant })
        setView(payload.merchant === null ? 'onboarding' : 'dashboard')
      })
      .catch(() => {
        setView('login')
        setNotice('Sesi tidak bisa diperiksa. Periksa koneksi ke backend.')
      })
  }, [])

  // Memuat daftar brand saat dipindahkan ke layar profil.
  useEffect(function loadBrandsIfNeeded() {
    if (view !== 'onboarding' || brandOptions.length > 0) {
      return
    }

    let cancelled = false

    async function fetchBrands() {
      try {
        setIsLoadingBrands(true)
        setBrandError('')

        const response = await fetch(`${API_BASE_URL}/api/brands`)

        if (!response.ok) {
          throw new Error('Gagal mengambil daftar brand')
        }

        const data: Brand[] = await response.json()

        if (!cancelled) {
          setBrandOptions(data)
        }
      } catch {
        if (!cancelled) {
          setBrandError('Daftar brand gagal dimuat. Periksa backend lalu coba lagi.')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBrands(false)
        }
      }
    }

    fetchBrands()

    return () => {
      cancelled = true
    }
  }, [view, brandOptions.length])

  // Menyiapkan tombol Google di layar masuk.
  useEffect(function renderGoogleButton() {
    if (view !== 'login' || !googleClientId) {
      return
    }

    let cancelled = false

    loadGoogleIdentity()
      .then((api) => {
        if (cancelled || !googleButtonRef.current) {
          return
        }

        api.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => credentialHandlerRef.current(response.credential),
        })

        api.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          locale: 'id',
        })
      })
      .catch(() => {
        if (!cancelled) {
          setNotice('Skrip masuk Google gagal dimuat. Periksa internet lalu muat ulang.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [view])

  // Pelulu waktu untuk label kesegaran titik.
  useEffect(function tickClock() {
    if (view !== 'dashboard') {
      return
    }

    const interval = setInterval(() => setNow(Date.now()), 30000)

    return () => clearInterval(interval)
  }, [view])

  async function handleGoogleCredential(credential: string) {
    setNotice('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: credential }),
      })

      const payload = await response.json()

      if (!response.ok) {
        setNotice(payload.error ?? 'Masuk gagal. Coba lagi.')
        return
      }

      const auth: ApiAuthResponse = payload

      saveSessionToken(auth.token)
      setSession({ token: auth.token, user: auth.user, merchant: auth.merchant })
      setNotice('')

      if (auth.merchant === null) {
        setFormName(auth.user.name)
        setFormPhone('')
        setFormBrandId('')
        setView('onboarding')
      } else {
        setView('dashboard')
      }
    } catch {
      setNotice('Masuk gagal. Pastikan backend berjalan lalu coba lagi.')
    }
  }

  // Menyimpan lokasi GPS terbaru ke backend, dan menandai jualan aktif.
  function handleUpdateLocation(silent: boolean) {
    const token = session?.token

    if (!token) {
      return
    }

    if (!navigator.geolocation) {
      if (!silent) {
        setNotice('Browser tidak mendukung GPS. Coba di HP atau pilih lokasi lewat peta.')
      }
      return
    }

    if (!silent) {
      setIsUpdatingLocation(true)
      setNotice('')
    }

    navigator.geolocation.getCurrentPosition(
      (position) => submitLocation(
        token,
        position.coords.latitude,
        position.coords.longitude,
        silent,
      ),
      (error) => {
        if (!silent) {
          setIsUpdatingLocation(false)

          let message = 'Lokasi gagal didapat. Periksa GPS lalu coba lagi.'

          if (error.code === error.PERMISSION_DENIED) {
            message = 'Izin lokasi ditolak. Izinkan akses lokasi di pengaturan browser.'
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = 'Lokasi belum tersedia. Periksa sinyal GPS atau koneksi.'
          } else if (error.code === error.TIMEOUT) {
            message = 'Pengambilan lokasi terlalu lama. Coba lagi di tempat lega.'
          }

          setNotice(message)
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    )
  }

  async function submitLocation(
    token: string,
    latitude: number,
    longitude: number,
    silent: boolean,
  ) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/merchants/me/location`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ latitude, longitude }),
      })

      if (!response.ok) {
        throw new Error('Gagal menyimpan lokasi')
      }

      const payload: ApiProfileResponse = await response.json()

      if (!silent) {
        setNotice('Titik jualan diperbarui. Sampai jumpa di peta.')
      }

      setSession((current) =>
        current
          ? { ...current, merchant: payload.merchant }
          : current,
      )
      setNow(Date.now())
    } catch (error) {
      if (!silent) {
        if (error instanceof Error) {
          setNotice(`${error.message}. Coba lagi atau periksa backend.`)
        } else {
          setNotice('Lokasi gagal disimpan. Coba lagi.')
        }
      }
    } finally {
      if (!silent) {
        setIsUpdatingLocation(false)
      }
    }
  }

  // Pembaruan titik otomatis selama jualan aktif dan layar terbuka.
  const updateRef = useRef(handleUpdateLocation)

  // Isi handler refs lewat effect, bukan saat render, supaya lint React
  // tenang dan closure yang disimpan selalu yang terbaru.
  useEffect(function syncHandlers() {
    credentialHandlerRef.current = handleGoogleCredential
    updateRef.current = handleUpdateLocation
  })

  useEffect(function autoUpdateLocation() {
    if (!session?.merchant?.is_available) {
      return
    }

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        updateRef.current(true)
      }
    }, AUTO_UPDATE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [session?.token, session?.merchant?.is_available])

  // Menandai sudah tutup berjualan.
  async function handleCloseShop() {
    const token = session?.token

    if (!token) {
      return
    }

    setIsClosing(true)
    setNotice('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/merchants/me/location`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })

      if (!response.ok) {
        throw new Error('Gagal menutup titik')
      }

      const payload: ApiProfileResponse = await response.json()

      setSession((current) =>
        current
          ? { ...current, merchant: payload.merchant }
          : current,
      )
      setNotice('Titik jualan ditutup. Terima kasih!')
    } catch {
      setNotice('Titik jualan gagal ditutup. Coba lagi.')
    } finally {
      setIsClosing(false)
    }
  }

  // Menyimpan profil toko dari form onboarding.
  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault()

    const token = session?.token

    if (!token) {
      return
    }

    const merchantName = formName.trim()

    if (!merchantName) {
      setNotice('Nama toko wajib diisi.')
      return
    }

    if (formBrandId === '') {
      setNotice('Pilih brand kopi yang kamu dagangkan.')
      return
    }

    setIsSavingProfile(true)
    setNotice('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/merchants/me/profile`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          merchant_name: merchantName,
          phone: formPhone.trim() === '' ? null : formPhone.trim(),
          brand_id: Number(formBrandId),
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        setNotice(payload.error ?? 'Profil gagal disimpan. Coba lagi.')
        return
      }

      setSession((current) =>
        current
          ? {
              ...current,
              merchant: (payload as ApiProfileResponse).merchant,
            }
          : current,
      )
      setView('dashboard')
      setNotice('Profil tersimpan. Aktifkan lokasi untuk memulai berjualan.')
    } catch {
      setNotice('Profil gagal disimpan. Pastikan backend berjalan.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  function handleLogout() {
    setSession(null)
    setNotice('')
    clearSessionToken()
    setView('login')
  }

  if (view === 'loading') {
    return <MerchantPageShell>
      <div role="status" aria-live="polite" className="py-12 text-center">
        <span
          aria-hidden="true"
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand"
        />
        <p className="mt-3 text-sm text-muted">Memeriksa sesi...</p>
      </div>
    </MerchantPageShell>
  }

  if (view === 'login') {
    return (
      <MerchantPageShell>
        <div className="rounded-xl border border-line bg-canvas p-6 sm:p-8">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Jualan, titikmu di peta
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            Untuk pedagang kopi keliling. Peta konsumen sudah terbuka;
            lengkapi titikmu lewat akun Google.
          </p>

          <div className="mt-6">
            {!googleClientId ? (
              <p className="rounded-lg bg-mist p-4 text-sm leading-relaxed text-ink">
                ID klien Google belum disetel. Atur{' '}
                <code className="font-mono text-xs">VITE_GOOGLE_CLIENT_ID</code>,
                lalu muat ulang halaman.
              </p>
            ) : (
              <div ref={googleButtonRef} className="flex justify-center" />
            )}
          </div>

          <NoticeText notice={notice} className="mt-4" />
        </div>
      </MerchantPageShell>
    )
  }

  if (view === 'onboarding') {
    return (
      <MerchantPageShell>
        <div className="rounded-xl border border-line bg-canvas p-6 sm:p-8">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Lengkapi toko kamu
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            Data ini yang dilihat konsumen di sekitar kamu.
          </p>

          <form
            className="mt-6 grid gap-5"
            onSubmit={handleSaveProfile}
          >
            <div className="grid gap-1.5">
              <label htmlFor="merchant-name" className="text-sm font-medium text-ink">
                Nama toko
              </label>

              <input
                id="merchant-name"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="Kopi Keliling - Pak Asep"
                maxLength={150}
                className="h-12 rounded-lg border border-line bg-canvas px-4 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="merchant-phone" className="text-sm font-medium text-ink">
                Nomor WA atau HP{' '}
                <span className="font-normal text-muted">(opsional)</span>
              </label>

              <input
                id="merchant-phone"
                value={formPhone}
                onChange={(event) => setFormPhone(event.target.value)}
                inputMode="tel"
                maxLength={30}
                placeholder="0812xxxxxxxx"
                className="h-12 rounded-lg border border-line bg-canvas px-4 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="merchant-brand" className="text-sm font-medium text-ink">
                Brand kopi
              </label>

              <div className="relative">
                <select
                  id="merchant-brand"
                  value={formBrandId}
                  onChange={(event) => setFormBrandId(event.target.value)}
                  className="h-12 w-full appearance-none rounded-lg border border-line bg-canvas pl-4 pr-10 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 invalid:text-muted"
                >
                  <option value="" disabled>
                    {isLoadingBrands ? 'Memuat brand...' : 'Pilih brand'}
                  </option>

                  {brandOptions.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  strokeWidth={1.75}
                />
              </div>

              {brandError && (
                <p className="text-xs leading-relaxed text-ink">{brandError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSavingProfile || isLoadingBrands}
              className="inline-flex h-12 items-center justify-center gap-3 rounded-lg bg-brand-strong text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingProfile && (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 animate-spin"
                  strokeWidth={2}
                />
              )}
              Simpan profil
            </button>
          </form>

          <NoticeText notice={notice} className="mt-4" />
        </div>
      </MerchantPageShell>
    )
  }

  const sessionValue = session

  if (!sessionValue?.merchant) {
    return null
  }

  const merchant = sessionValue.merchant

  const updatedLabel = formatRelativeTime(
    merchant.location_updated_at,
    now,
  )

  const minutesSinceUpdate = merchant.location_updated_at
    ? Math.round((now - Date.parse(merchant.location_updated_at)) / 60000)
    : Infinity

  const isSelling =
    merchant.is_available &&
    minutesSinceUpdate <= LOCATION_TTL_MINUTES

  return (
    <MerchantPageShell>
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-canvas p-4">
          <div className="flex min-w-0 items-center gap-3">
            {sessionValue.user.avatar_url ? (
              <AvatarView
                src={sessionValue.user.avatar_url}
                initial={sessionValue.user.name.charAt(0).toUpperCase()}
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mist text-sm font-semibold text-ink"
              >
                {sessionValue.user.name.charAt(0).toUpperCase()}
              </span>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {sessionValue.user.name}
              </p>
              <p className="truncate text-xs text-muted">
                {sessionValue.user.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand-strong"
          >
            <LogOut
              aria-hidden="true"
              className="h-4 w-4"
              strokeWidth={1.75}
            />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>

        <div className="rounded-xl border border-line bg-canvas p-5 sm:p-6">
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink"
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${
                isSelling ? 'bg-brand' : 'bg-muted'
              }`}
            />
            {isSelling
              ? 'Sedang jualan'
              : merchant.is_available
                ? 'Titik jualan hangat'
                : 'Sudah tutup'}
          </p>

          <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-ink">
            {merchant.merchant_name}
          </h2>

          <p className="mt-1 text-sm text-muted">
            Brand {merchant.brand_name}
            {merchant.phone ? ` · ${merchant.phone}` : ''}
          </p>

          <p className="mt-3 text-xs tabular-nums text-muted">
            {merchant.location_updated_at
              ? `Titik terakhir diperbarui ${updatedLabel ?? 'beberapa waktu lalu'}`
              : 'Titik belum ada. Aktifkan lokasi untuk mulai jualan.'}
          </p>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleUpdateLocation(false)}
              disabled={isUpdatingLocation}
              className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-brand-strong px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUpdatingLocation ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <LocateFixed
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0"
                  strokeWidth={1.75}
                />
              )}

              {isSelling ? 'Perbarui lokasi' : 'Aku lagi jualan'}
            </button>

            <button
              type="button"
              onClick={handleCloseShop}
              disabled={isClosing || !merchant.is_available}
              className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-lg border border-line bg-canvas px-5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isClosing ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <Power
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.75}
                />
              )}
              Tutup jualan
            </button>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Selama aplikasi terbuka, titik dikirim ulang tiap 10 menit.
            Tanpa pembaruan lebih dari dua jam, titikmu otomatis hilang
            dari peta.
          </p>
        </div>

        <NoticeText notice={notice} className="tabular-nums" />
      </div>
    </MerchantPageShell>
  )
}

// Avatar dengan pengaman: kalau foto profil Google gagal dimuat,
// tampil inisial nama, bukan lambang gambar rusak.
function AvatarView({
  src,
  initial,
}: {
  src: string
  initial: string
}) {
  const [hasFailed, setHasFailed] = useState(false)

  if (hasFailed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mist text-sm font-semibold text-ink"
      >
        {initial}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setHasFailed(true)}
      className="h-11 w-11 shrink-0 rounded-full border border-line object-cover"
    />
  )
}

// Kerangka halaman: header dengan jalan pulang ke halaman konsumen.
function MerchantPageShell({
  children,
}: {
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-lg items-center gap-4 px-5 py-4 sm:px-6">
          <a
            href="#/"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
          >
            <ChevronLeft
              aria-hidden="true"
              className="h-4 w-4"
              strokeWidth={1.75}
            />
            Cari kopi
          </a>

          <span className="font-display text-base font-bold tracking-tight text-muted">
            Area Pedagang
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-5 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </main>
  )
}

// Pesan status yang selalu tampil dengan sebab dan saran tindak lanjut.
function NoticeText({
  notice,
  className = '',
}: {
  notice: string
  className?: string
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs leading-relaxed text-ink empty:hidden ${className}`}
    >
      {notice}
    </p>
  )
}

export default MerchantPage
