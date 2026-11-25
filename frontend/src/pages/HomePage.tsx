
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Navigation,
  RotateCcw,
} from 'lucide-react'
import BrandFilter from '../components/BrandFilter'
import GerobakIcon from '../components/GerobakIcon'
import MapView from '../components/MapView'
import { resolveMarkerColor, resolveMarkerIconColor } from '../lib/marker'
import { formatRelativeTime } from '../lib/format'
import { API_BASE_URL } from '../lib/api'

type UserLocation = {
  latitude: number
  longitude: number
}

const ALL_BRANDS = 'Semua kategori'

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
  logo_url: string | null
  marker_colors: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  is_available: boolean
  location_updated_at: string | null
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
  logoUrl: string | null
  markerColor: string
  latitude: number
  longitude: number
  isAvailable: boolean
  // Label seperti "5 mnt lalu" yang memperlihatkan kesegaran titik.
  updatedLabel: string | null
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

// Logo brand dengan pengaman: kalau gambar gagal dimuat (misalnya
// berbagi Drive berubah atau diblokir ekstensi), ikon kopi yang tampil
// ali-alih lambang gambar rusak.
function BrandLogo({
  src,
  iconColor,
}: {
  src: string | null
  iconColor: string
}) {
  const [hasFailed, setHasFailed] = useState(false)

  if (!src || hasFailed) {
    return (
      <GerobakIcon className="h-4 w-4" color={iconColor} />
    )
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setHasFailed(true)}
      className="h-full w-full object-cover"
    />
  )
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
          `${API_BASE_URL}/api/merchants?${params.toString()}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Gagal mengambil daftar pedagang.')
        }

        const payload: ApiMerchantsResponse = await response.json()

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
            logoUrl: merchant.logo_url,
            markerColor: resolveMarkerColor(
              merchant.marker_colors ?? undefined,
            ),
            latitude: merchant.latitude!,
            longitude: merchant.longitude!,
            isAvailable: merchant.is_available,
            updatedLabel: formatRelativeTime(
              merchant.location_updated_at,
              Date.now(),
            ),
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

        const response = await fetch(`${API_BASE_URL}/api/brands`, {
          signal: controller.signal,
        })

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
  // tidak mengikuti lokasi default Google Maps. Tanpa dir_action=navigate
  // supaya Maps hanya menampilkan rute dan tombol "Mulai", bukan langsung
  // otow: pengguna tetap yang memutuskan.
  function handleNavigateToMerchant(
    latitude: number,
    longitude: number,
  ) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${latitude},${longitude}`,
      travelmode: 'driving',
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
      <header className="border-b-[3px] border-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-1">
            <a
              href="/"
              className="w-fit font-display text-xl leading-none tracking-tight text-ink sm:text-2xl"
            >
              CarDaLing
            </a>

            <span className="text-xs font-semibold text-muted">
              Cari Pedagang Keliling
            </span>
          </div>

          <a
            href="#/pedagang"
            className="brutal-press inline-flex h-11 items-center whitespace-nowrap rounded-[10px] border-2 border-ink bg-canvas px-3 text-xs font-bold shadow-brutal-sm sm:px-4 sm:text-sm"
          >
            Area Pedagang
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-6">
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
          <section
            aria-label="Filter dan lokasi"
            className="rounded-2xl border-2 border-ink bg-canvas p-3 shadow-brutal sm:p-4 lg:col-span-5 lg:col-start-1 lg:row-start-1"
          >
            <div className="grid grid-cols-2 gap-3 lg:flex lg:items-center">
              <button
                type="button"
                onClick={handleGetLocation}
                disabled={isLocating}
                className="brutal-press inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border-2 border-ink bg-accent-soft px-3 text-xs font-bold text-ink shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:gap-3 sm:px-5 sm:text-sm"
              >
                {isLocating ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 animate-spin sm:h-5 sm:w-5"
                    strokeWidth={2}
                  />
                ) : (
                  <LocateFixed
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
                    strokeWidth={2}
                  />
                )}

                {isLocating ? (
                  <>
                    <span className="sm:hidden">Mencari...</span>
                    <span className="hidden sm:inline lg:hidden">
                      Mencari lokasi...
                    </span>
                    <span className="hidden lg:inline">Mencari...</span>
                  </>
                ) : userLocation ? (
                  <>
                    <span className="sm:hidden">Perbarui</span>
                    <span className="hidden sm:inline lg:hidden">
                      Perbarui lokasi
                    </span>
                    <span className="hidden lg:inline">Perbarui</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Lokasi saya</span>
                    <span className="hidden sm:inline lg:hidden">
                      Gunakan lokasi saya
                    </span>
                    <span className="hidden lg:inline">Lokasi saya</span>
                  </>
                )}
              </button>

              <div className="min-w-0 lg:flex-1">
                <label htmlFor="brand-filter" className="sr-only">
                  Filter kategori
                </label>

                <BrandFilter
                  id="brand-filter"
                  brands={brandOptions}
                  value={selectedBrand}
                  allLabel={ALL_BRANDS}
                  isLoading={isLoadingBrands}
                  error={brandError}
                  onChange={(brand) => {
                    setSelectedBrand(brand)
                    setSelectedMerchantId(null)
                  }}
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
          </section>

          <section
            ref={mapSectionRef}
            aria-label="Peta lokasi pedagang"
            className="scroll-mt-4 rounded-2xl border-2 border-ink bg-canvas p-3 shadow-brutal lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-2"
          >
            <MapView
              merchants={merchantsWithDistance}
              selectedMerchantId={selectedMerchantId}
              userLocation={userLocation}
            />
          </section>

          <section className="rounded-2xl border-2 border-ink bg-canvas p-4 shadow-brutal sm:p-5 lg:col-span-7 lg:col-start-6 lg:row-start-1">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div>
                <h3
                  id="daftar-pedagang"
                  className="font-display text-xl leading-tight tracking-tight text-ink sm:text-2xl"
                >
                  Pedagang di sekitar
                </h3>

                <p className="text-xs font-medium text-muted">
                  {userLocation
                    ? 'Diurutkan dari yang paling dekat.'
                    : 'Aktifkan lokasi untuk melihat jarak.'}
                </p>
              </div>

              <span className="shrink-0 rounded-lg border-2 border-ink bg-mist px-2 py-0.5 text-xs font-bold tabular-nums text-ink">
                {merchantsMeta?.total ?? 0} pedagang
              </span>
            </div>
          </section>

          <section
            aria-labelledby="daftar-pedagang"
            className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-2"
          >
            {isLoadingMerchants ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-2xl border-2 border-dashed border-ink px-4 py-8 text-center sm:py-10"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-6 w-6 animate-spin border-[3px] border-ink border-t-brand"
                />

                <p className="mt-3 text-sm font-medium text-muted">
                  Memuat daftar pedagang...
                </p>
              </div>
            ) : merchantError ? (
              <div className="rounded-2xl border-2 border-dashed border-ink px-4 py-8 text-center sm:py-10">
                <p className="font-bold text-ink">
                  Daftar pedagang belum bisa dimuat
                </p>

                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  {merchantError}
                </p>
              </div>
            ) : merchantsWithDistance.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-ink px-4 py-8 text-center sm:py-10">
                <p className="font-bold text-ink">
                  Belum ada pedagang yang cocok
                </p>

                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  Coba tampilkan semua kategori.
                </p>

                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="brutal-press mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] border-2 border-ink bg-canvas px-4 text-sm font-bold shadow-brutal-sm"
                >
                  <RotateCcw
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={2}
                  />
                  Reset filter
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:gap-4">
                {merchantsWithDistance.map((merchant) => {
                  const isSelected =
                    merchant.id === selectedMerchantId

                  return (
                    <li
                      key={merchant.id}
                      className={`brutal-press-lg flex h-full flex-col rounded-2xl border-2 border-ink ${
                        isSelected
                          ? 'bg-accent shadow-brutal-lg'
                          : 'bg-canvas shadow-brutal'
                      }`}
                    >
                      <div className="flex h-full flex-col overflow-hidden p-2.5 sm:p-4">
                        <div className="flex items-start gap-2 sm:gap-3">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-ink sm:h-10 sm:w-10 ${
                              isSelected ? 'bg-canvas' : 'bg-mist'
                            }`}
                          >
                            <BrandLogo
                              src={merchant.logoUrl}
                              iconColor={resolveMarkerIconColor(
                                merchant.markerColor,
                              )}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <h3 className="flex items-baseline gap-x-2 text-xs font-bold text-ink sm:text-sm">
                              <span className="line-clamp-2">
                                {merchant.name}
                              </span>

                              {isSelected && (
                                <span className="hidden shrink-0 rounded-md border border-ink bg-canvas px-1.5 py-0.5 text-[11px] font-bold text-ink sm:inline-flex">
                                  Dipilih
                                </span>
                              )}
                            </h3>

                            <p
                              className={`mt-1 flex items-center gap-x-2 text-[11px] max-[359px]:flex-col max-[359px]:gap-y-0.5 sm:flex-wrap sm:gap-y-1 sm:text-xs ${
                                isSelected
                                  ? 'font-medium text-ink'
                                  : 'text-muted'
                              }`}
                            >
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-ink"
                                  style={{
                                    backgroundColor:
                                      merchant.markerColor,
                                  }}
                                />
                                <span className="max-sm:truncate">
                                  {merchant.brand}
                                </span>
                              </span>

                              <span className="inline-flex shrink-0 items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="max-[359px]:hidden"
                                >
                                  /
                                </span>

                                <span className="tabular-nums">
                                  {merchant.distanceInKm === null ? (
                                    <>
                                      {/* Di HP, jarak yang belum diketahui
                                          dipendekkan agar tidak meluber. */}
                                      <span className="sm:hidden">-</span>
                                      <span className="hidden sm:inline">
                                        {merchant.distanceLabel}
                                      </span>
                                    </>
                                  ) : (
                                    merchant.distanceLabel
                                  )}
                                </span>
                              </span>
                            </p>

                            {merchant.updatedLabel && (
                              <p className="mt-1 hidden text-xs tabular-nums text-muted sm:block">
                                Titik diperbarui {merchant.updatedLabel}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="mt-auto flex gap-2 pt-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleSelectMerchant(merchant.id)
                            }
                            aria-pressed={isSelected}
                            aria-label={`Lihat lokasi ${merchant.name} di peta`}
                            className="brutal-press inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border-2 border-ink bg-canvas px-2 text-sm font-bold text-ink shadow-brutal-sm sm:gap-2 sm:px-3"
                          >
                            <MapPin
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={2}
                            />
                            <span className="hidden sm:inline">Lokasi</span>
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
                            className="brutal-press inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border-2 border-ink bg-accent-soft px-2 text-sm font-bold text-ink shadow-brutal-sm sm:gap-2 sm:px-3"
                          >
                            <Navigation
                              aria-hidden="true"
                              className="h-4 w-4"
                              strokeWidth={2}
                            />
                            <span className="hidden sm:inline">Rute</span>
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {totalPages > 1 && (
            <nav
              aria-label="Navigasi halaman daftar pedagang"
              className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-canvas p-3 shadow-brutal lg:col-span-7 lg:col-start-6 lg:row-start-3"
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
                  className="brutal-press inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] border-2 border-ink bg-canvas px-3.5 text-sm font-bold text-ink shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ChevronLeft
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={2}
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
                  className="brutal-press inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] border-2 border-ink bg-canvas px-3.5 text-sm font-bold text-ink shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="hidden sm:inline">Berikutnya</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={2}
                  />
                </button>
              </nav>
            )}
        </div>
      </div>

      <footer className="border-t-[3px] border-ink">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-8 text-sm text-muted sm:flex-row sm:items-baseline sm:gap-3 sm:px-6">
          <span className="font-display text-base text-ink">
            CarDaLing
          </span>
          <span>By <b>Daniar Nur Amin</b></span>
        </div>
      </footer>
    </main>
  )
}

export default HomePage
