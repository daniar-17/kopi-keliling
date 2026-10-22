
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Navigation,
  RotateCcw,
} from 'lucide-react'
import MapView from '../components/MapView'

type UserLocation = {
  latitude: number
  longitude: number
}

const ALL_BRANDS = 'Semua brand'

// Batas jumlah pedagang per halaman pada grid 2 kolom tampilan desktop.
const MERCHANTS_PER_PAGE = 6

type Brand = {
  id: number
  name: string
  logo_url: string | null
  is_active: boolean
}

type ApiMerchant = {
  id: number
  merchant_name: string
  brand_id: number
  brand_name: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  is_available: boolean
}

// Metadata pagination yang dikirim backend bersama data pedagang.
type MerchantsMeta = {
  page: number
  limit: number
  total: number
  total_pages: number
  brand_counts: {
    brand_name: string
    count: number
  }[]
}

type ApiMerchantsResponse = {
  data: ApiMerchant[]
  meta: MerchantsMeta
}

type Merchant = {
  id: number
  name: string
  brand: string
  markerColor: string
  latitude: number
  longitude: number
  isAvailable: boolean
}

// Menghitung jarak dua koordinat menggunakan rumus Haversine.
function calculateDistance(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const earthRadius = 6371 // radius bumi dalam kilometer
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180

  const latitudeDifference = toRadians(latitude2 - latitude1)
  const longitudeDifference = toRadians(longitude2 - longitude1)

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(latitude1)) *
      Math.cos(toRadians(latitude2)) *
      Math.sin(longitudeDifference / 2) ** 2

  const safeA = Math.min(1, Math.max(0, a))
  const centralAngle =
    2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA))

  return earthRadius * centralAngle
}

// Format jarak agar mudah dibaca.
function formatDistance(distanceInKm: number): string {
  if (distanceInKm < 1) {
    const meters = Math.round(distanceInKm * 1000)
    return `${meters} m`
  }

  return `${distanceInKm.toLocaleString('id-ID', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} km`
}

function HomePage() {
  const [selectedMerchantId, setSelectedMerchantId] =
    useState<number | null>(null)
  const [selectedBrand, setSelectedBrand] = useState(ALL_BRANDS)

  // Halaman daftar disimpan bersama brand-nya supaya ganti brand otomatis
  // kembali ke halaman 1 tanpa perlu efek tambahan.
  const [pageState, setPageState] = useState({
    brand: ALL_BRANDS,
    page: 1,
  })

  const [brands, setBrands] = useState<Brand[]>([])
  const [isLoadingBrands, setIsLoadingBrands] = useState(true)
  const [brandError, setBrandError] = useState('')

  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [isLoadingMerchants, setIsLoadingMerchants] = useState(true)
  const [merchantError, setMerchantError] = useState('')
  const [merchantsMeta, setMerchantsMeta] =
    useState<MerchantsMeta | null>(null)

  const [userLocation, setUserLocation] =
    useState<UserLocation | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')

  const mapSectionRef = useRef<HTMLElement>(null)

  // Jumlah halaman diambil dari meta respons backend, dan halaman aktif
  // dihitung saat render: brand yang baru dipilih memulai dari halaman 1,
  // dan halaman tidak boleh melebihi jumlah yang tersisa.
  const totalPages = Math.max(1, merchantsMeta?.total_pages ?? 1)

  const currentPage = Math.min(
    pageState.brand === selectedBrand ? pageState.page : 1,
    totalPages,
  )

  useEffect(() => {
    const controller = new AbortController()

    async function fetchMerchants() {
      try {
        setIsLoadingMerchants(true)
        setMerchantError('')

        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(MERCHANTS_PER_PAGE),
        })

        // Filter brand dan urutan terdekat sudah ditangani backend lewat
        // query parameter.
        if (selectedBrand !== ALL_BRANDS) {
          params.set('brand', selectedBrand)
        }

        if (userLocation) {
          params.set('latitude', String(userLocation.latitude))
          params.set('longitude', String(userLocation.longitude))
        }

        const response = await fetch(
          `http://localhost:8080/api/merchants?${params.toString()}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Gagal mengambil daftar pedagang.')
        }

        const payload: ApiMerchantsResponse = await response.json()

        const markerColors = ['#b45309', '#0f766e', '#be123c']

        const mappedMerchants: Merchant[] = payload.data
          .filter(
            (merchant) =>
              merchant.latitude !== null &&
              merchant.longitude !== null,
          )
          .map((merchant) => ({
            id: merchant.id,
            name: merchant.merchant_name,
            brand: merchant.brand_name,
            markerColor:
              markerColors[
                (merchant.brand_id - 1) % markerColors.length
              ],
            latitude: merchant.latitude!,
            longitude: merchant.longitude!,
            isAvailable: merchant.is_available,
          }))

        setMerchants(mappedMerchants)
        setMerchantsMeta(payload.meta)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }

        setMerchantError(
          'Daftar pedagang gagal dimuat. Pastikan backend Go berjalan.',
        )
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingMerchants(false)
        }
      }
    }

    fetchMerchants()

    return () => controller.abort()
  }, [currentPage, selectedBrand, userLocation])

  // Ambil daftar brand aktif dari backend.
  useEffect(() => {
    const controller = new AbortController()

    async function fetchBrands() {
      try {
        setIsLoadingBrands(true)
        setBrandError('')

        const response = await fetch(
          'http://localhost:8080/api/brands',
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Gagal mengambil daftar brand.')
        }

        const data: Brand[] = await response.json()

        setBrands(data)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }

        setBrandError('Daftar brand gagal dimuat.')
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingBrands(false)
        }
      }
    }

    fetchBrands()

    return () => controller.abort()
  }, [])

  const brandOptions = useMemo(() => {
    const counts = new Map<string, number>()

    merchantsMeta?.brand_counts.forEach(({ brand_name, count }) => {
      counts.set(brand_name, count)
    })

    return brands.map((brand) => ({
      brand: brand.name,
      count: counts.get(brand.name) ?? 0,
    }))
  }, [brands, merchantsMeta])

  // Jarak dihitung di sisi klien untuk label, sedangkan urutan pedagang
  // sudah ditentukan backend (paling dekat lebih dulu saat GPS aktif).
  const merchantsWithDistance = useMemo(() => {
    return merchants.map((merchant) => {
      const distanceInKm = userLocation
        ? calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            merchant.latitude,
            merchant.longitude,
          )
        : null

      return {
        ...merchant,
        distanceInKm,
        distanceLabel:
          distanceInKm === null
            ? 'Jarak belum diketahui'
            : formatDistance(distanceInKm),
      }
    })
  }, [merchants, userLocation])

  function handleGetLocation() {
    if (!navigator.geolocation) {
      setLocationMessage(
        'Browser kamu tidak mendukung fitur lokasi GPS.',
      )
      return
    }

    setIsLocating(true)
    setLocationMessage('')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })

        setSelectedMerchantId(null)
        setIsLocating(false)
        setLocationMessage('')
      },
      (error) => {
        let message =
          'Lokasi gagal didapatkan. Periksa GPS lalu coba lagi.'

        if (error.code === error.PERMISSION_DENIED) {
          message =
            'Izin lokasi ditolak. Izinkan akses lokasi lewat pengaturan browser.'
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message =
            'Lokasi belum tersedia. Periksa GPS atau koneksi perangkat.'
        } else if (error.code === error.TIMEOUT) {
          message =
            'Pengambilan lokasi terlalu lama. Silakan coba lagi.'
        }

        setLocationMessage(message)
        setIsLocating(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    )
  }

  // Rute dimulai dari GPS pengguna bila sudah aktif, supaya titik awal
  // tidak mengikuti lokasi default Google Maps.
  function handleNavigateToMerchant(
    latitude: number,
    longitude: number,
  ) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${latitude},${longitude}`,
      travelmode: 'driving',
      dir_action: 'navigate',
    })

    if (userLocation) {
      params.set(
        'origin',
        `${userLocation.latitude},${userLocation.longitude}`,
      )
    }

    window.open(
      `https://www.google.com/maps/dir/?${params.toString()}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  function handleResetFilters() {
    setSelectedBrand(ALL_BRANDS)
    setSelectedMerchantId(null)
  }

  // Di layar kecil peta berada di bawah daftar, jadi bawa tampilan ke peta.
  function handleSelectMerchant(merchantId: number) {
    setSelectedMerchantId(merchantId)

    if (window.matchMedia('(max-width: 1023px)').matches) {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches

      mapSectionRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <a
            href="/"
            className="font-display text-xl font-bold tracking-tight text-ink"
          >
            Kopi<span className="text-brand-strong">Keliling</span>
          </a>

          <p className="hidden text-sm text-muted sm:block">
            Cari Kopi Keliling
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-6">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-10">
          <section
            ref={mapSectionRef}
            aria-label="Peta lokasi pedagang"
            className="scroll-mt-4 lg:sticky lg:top-6 lg:self-start"
          >
            <div className="grid grid-cols-2 gap-3 lg:flex lg:items-center">
              <button
                type="button"
                onClick={handleGetLocation}
                disabled={isLocating}
                className="inline-flex h-12 items-center justify-center gap-3 rounded-lg bg-brand-strong text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
              >
                {isLocating ? (
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

                {isLocating ? (
                  <>
                    <span className="sm:hidden">Mencari...</span>
                    <span className="hidden sm:inline">
                      Mencari lokasi...
                    </span>
                  </>
                ) : userLocation ? (
                  <>
                    <span className="sm:hidden">Perbarui</span>
                    <span className="hidden sm:inline">
                      Perbarui lokasi
                    </span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Lokasi saya</span>
                    <span className="hidden sm:inline">
                      Gunakan lokasi saya
                    </span>
                  </>
                )}
              </button>

              <div className="relative min-w-0 lg:flex-1">
                <label htmlFor="brand-filter" className="sr-only">
                  Filter brand
                </label>

                <select
                  id="brand-filter"
                  value={selectedBrand}
                  onChange={(event) => {
                    setSelectedBrand(event.target.value)
                    setSelectedMerchantId(null)
                  }}
                  className="h-12 w-full appearance-none rounded-lg border border-line bg-canvas pl-4 pr-10 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value={ALL_BRANDS}>{ALL_BRANDS}</option>

                  {isLoadingBrands && (
                    <option value="" disabled>
                      Memuat brand...
                    </option>
                  )}

                  {!isLoadingBrands && brandError && (
                    <option value="" disabled>
                      Brand gagal dimuat
                    </option>
                  )}

                  {!isLoadingBrands &&
                    !brandError &&
                    brandOptions.map(({ brand, count }) => (
                      <option key={brand} value={brand}>
                        {brand} ({count})
                      </option>
                    ))}
                </select>

                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  strokeWidth={1.75}
                />
              </div>
            </div>

            <p
              role="status"
              aria-live="polite"
              className="mt-2 text-xs text-ink empty:hidden"
            >
              {locationMessage}
            </p>

            <div className="mt-3">
              <MapView
                merchants={merchantsWithDistance}
                selectedMerchantId={selectedMerchantId}
                userLocation={userLocation}
              />
            </div>
          </section>

          <section aria-labelledby="daftar-pedagang" className="min-w-0">
            <div className="flex items-end justify-between gap-4 border-b border-line pb-3 sm:pb-3">
              <div>
                <h2
                  id="daftar-pedagang"
                  className="font-display text-xl font-semibold tracking-tight text-ink sm:text-[1.75rem]"
                >
                  Pedagang di sekitar
                </h2>

                <p className="mt-1 text-sm text-muted">
                  {userLocation
                    ? 'Diurutkan dari yang paling dekat.'
                    : 'Aktifkan lokasi untuk melihat jarak.'}
                </p>
              </div>

              <span className="shrink-0 text-xs tabular-nums text-muted sm:text-sm">
                {merchantsMeta?.total ?? 0} pedagang
              </span>
            </div>

            {isLoadingMerchants ? (
              <div
                role="status"
                aria-live="polite"
                className="border-b border-line py-8 text-center sm:py-12"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand"
                />

                <p className="mt-3 text-sm text-muted">
                  Memuat daftar pedagang...
                </p>
              </div>
            ) : merchantError ? (
              <div className="border-b border-line py-8 text-center sm:py-12">
                <p className="font-semibold text-ink">
                  Daftar pedagang belum bisa dimuat
                </p>

                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  {merchantError}
                </p>
              </div>
            ) : merchantsWithDistance.length === 0 ? (
              <div className="border-b border-line py-8 text-center sm:py-12">
                <p className="font-semibold text-ink">
                  Belum ada pedagang yang cocok
                </p>

                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  Coba tampilkan semua brand.
                </p>

                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
                >
                  <RotateCcw
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                  Reset filter
                </button>
              </div>
            ) : (
              <ul className="-mx-5 mt-5 flex snap-x snap-mandatory scroll-pl-5 gap-3 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:scroll-pl-6 sm:px-6 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-2 lg:overflow-visible lg:px-0 lg:pb-0">
                {merchantsWithDistance.map((merchant) => {
                  const isSelected =
                    merchant.id === selectedMerchantId

                  return (
                    <li
                      key={merchant.id}
                      className={`w-60 shrink-0 snap-start rounded-xl border transition-colors lg:w-auto lg:shrink ${
                        isSelected
                          ? 'border-brand bg-brand-soft'
                          : 'border-line bg-canvas'
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line ${
                              isSelected ? 'bg-canvas' : 'bg-mist'
                            }`}
                          >
                            <Coffee
                              aria-hidden="true"
                              className={`h-4 w-4 ${
                                isSelected
                                  ? 'text-brand-strong'
                                  : 'text-muted'
                              }`}
                              strokeWidth={1.75}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold text-ink">
                              {merchant.name}

                              {isSelected && (
                                <span className="text-xs font-medium text-brand-strong">
                                  Dipilih
                                </span>
                              )}
                            </h3>

                            <p
                              className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
                                isSelected
                                  ? 'text-ink'
                                  : 'text-muted'
                              }`}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor:
                                      merchant.markerColor,
                                  }}
                                />
                                {merchant.brand}
                              </span>

                              <span aria-hidden="true">/</span>

                              <span className="tabular-nums">
                                {merchant.distanceLabel}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleSelectMerchant(merchant.id)
                            }
                            aria-pressed={isSelected}
                            aria-label={`Lihat lokasi ${merchant.name} di peta`}
                            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                              isSelected
                                ? 'border-brand bg-canvas text-brand-strong'
                                : 'border-line bg-canvas text-ink hover:border-brand hover:text-brand-strong'
                            }`}
                          >
                            <MapPin
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                            Lokasi
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleNavigateToMerchant(
                                merchant.latitude,
                                merchant.longitude,
                              )
                            }
                            aria-label={`Buka rute ke ${merchant.name} di Google Maps`}
                            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-strong transition-colors ${
                              isSelected
                                ? 'hover:bg-canvas'
                                : 'hover:bg-brand-soft'
                            }`}
                          >
                            <Navigation
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={1.75}
                            />
                            Rute
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {totalPages > 1 && (
              <nav
                aria-label="Navigasi halaman daftar pedagang"
                className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4"
              >
                <button
                  type="button"
                  onClick={() =>
                    setPageState({
                      brand: selectedBrand,
                      page: currentPage - 1,
                    })
                  }
                  disabled={currentPage === 1}
                  aria-label="Halaman sebelumnya"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-canvas px-3.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ChevronLeft
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                  <span className="hidden sm:inline">Sebelumnya</span>
                </button>

                <p
                  aria-live="polite"
                  className="text-sm tabular-nums text-muted"
                >
                  Halaman {currentPage} dari {totalPages}
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setPageState({
                      brand: selectedBrand,
                      page: currentPage + 1,
                    })
                  }
                  disabled={currentPage === totalPages}
                  aria-label="Halaman berikutnya"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-canvas px-3.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="hidden sm:inline">Berikutnya</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                </button>
              </nav>
            )}
          </section>
        </div>
      </div>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-8 text-sm text-muted sm:flex-row sm:items-baseline sm:gap-3 sm:px-6">
          <span className="font-display text-base font-semibold text-ink">
            KopiKeliling
          </span>
          <span>By <b>Daniar Nur Amin</b></span>
        </div>
      </footer>
    </main>
  )
}

export default HomePage
