
import { useEffect, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import GerobakIcon from './GerobakIcon'
import { resolveMarkerColor, resolveMarkerIconColor } from '../lib/marker'

type Merchant = {
  id: number
  name: string
  latitude: number
  longitude: number
  markerColor?: string
}

type UserLocation = {
  latitude: number
  longitude: number
}

type MapViewProps = {
  merchants: Merchant[]
  selectedMerchantId: number | null
  userLocation: UserLocation | null
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Popup Leaflet dirender sebagai HTML, jadi nama pedagang di-escape dulu.
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}

// Marker pedagang memakai warna data per brand. Bentuknya kotak dengan
// border tinta dan bayangan keras; marker terpilih diberi garis aksen.
function createMerchantIcon(
  markerColor: string,
  isSelected: boolean,
) {
  const size = isSelected ? 44 : 38
  const iconSize = isSelected ? 24 : 21
  const shadow = isSelected
    ? '6px 6px 0 0 #111111'
    : '4px 4px 0 0 #111111'
  const outline = isSelected
    ? 'outline: 3px solid #ffc93c; outline-offset: 2px;'
    : ''

  const cartGlyph = renderToStaticMarkup(
    <GerobakIcon
      size={iconSize}
      color={resolveMarkerIconColor(markerColor)}
    />,
  )

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${markerColor};
        border: 3px solid #111111;
        border-radius: 6px;
        box-shadow: ${shadow};
        ${outline}
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="display: flex; line-height: 0;">
          ${cartGlyph}
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 8],
  })
}

// Cache icon supaya marker tidak dibuat ulang tiap render.
const merchantIconCache = new Map<string, L.DivIcon>()

function getMerchantIcon(markerColor: string, isSelected: boolean) {
  const cacheKey = `${markerColor}:${isSelected}`

  let icon = merchantIconCache.get(cacheKey)

  if (!icon) {
    icon = createMerchantIcon(markerColor, isSelected)
    merchantIconCache.set(cacheKey, icon)
  }

  return icon
}

function MapView({
  merchants,
  selectedMerchantId,
  userLocation,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.LayerGroup | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)

  // Inisialisasi peta satu kali.
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const map = L.map(container).setView([-6.2, 106.8166], 12)

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    markersRef.current = L.layerGroup().addTo(map)

    // Tile mengikuti tinggi tile bento yang bisa berubah saat font selesai
    // dimuat atau daftar pedagang bertambah. Tanpa ini, area kosong muncul
    // di bawah peta karena Leaflet menyimpan ukuran awal.
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })

    resizeObserver.observe(container)

    const frame = requestAnimationFrame(() => {
      map.invalidateSize()
    })

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current = null
      userMarkerRef.current = null
    }
  }, [])

  // Tampilkan marker pedagang.
  useEffect(() => {
    const map = mapRef.current
    const markerGroup = markersRef.current

    if (!map || !markerGroup) return

    markerGroup.clearLayers()

    const validMerchants = merchants.filter(
      (merchant) =>
        Number.isFinite(merchant.latitude) &&
        Number.isFinite(merchant.longitude) &&
        Math.abs(merchant.latitude) <= 90 &&
        Math.abs(merchant.longitude) <= 180,
    )

    validMerchants.forEach((merchant) => {
      const isSelected = merchant.id === selectedMerchantId
      const markerColor = resolveMarkerColor(merchant.markerColor)

      L.marker([merchant.latitude, merchant.longitude], {
        icon: getMerchantIcon(markerColor, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      })
        .bindPopup(
          `<span style="
            display: inline-block;
            width: 8px;
            height: 8px;
            margin-right: 6px;
            border-radius: 9999px;
            background: ${markerColor};
          "></span><strong>${escapeHtml(merchant.name)}</strong>`,
        )
        .addTo(markerGroup)
    })

    // Saat GPS aktif, tampilan peta dipertahankan di lokasi pengguna.
    if (!userLocation && validMerchants.length > 0) {
      const bounds = L.latLngBounds(
        validMerchants.map(
          (merchant) =>
            [merchant.latitude, merchant.longitude] as L.LatLngTuple,
        ),
      )

      map.fitBounds(bounds, {
        padding: [35, 35],
        maxZoom: 15,
      })
    }
  }, [merchants, selectedMerchantId, userLocation])

  // Titik hijau menunjukkan lokasi pengguna.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !userLocation) return

    const { latitude, longitude } = userLocation

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([latitude, longitude])
    } else {
      userMarkerRef.current = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: '',
          html: `
            <div style="
              width: 18px;
              height: 18px;
              background: #0c9b62;
              border: 3px solid #111111;
              border-radius: 4px;
              box-shadow: 3px 3px 0 0 #111111;
            "></div>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        keyboard: false,
        zIndexOffset: 500,
      }).addTo(map)

      userMarkerRef.current.bindPopup('Lokasi kamu')
    }

    // Langsung arahkan peta ke lokasi pengguna yang baru didapat.
    if (prefersReducedMotion()) {
      map.setView([latitude, longitude], 15)
    } else {
      map.flyTo([latitude, longitude], 15, { duration: 0.9 })
    }
  }, [userLocation])

  // Tombol "Lihat lokasi" memusatkan peta ke pedagang terpilih.
  useEffect(() => {
    if (selectedMerchantId === null) return

    const merchant = merchants.find(
      (item) => item.id === selectedMerchantId,
    )

    const map = mapRef.current
    if (!merchant || !map) return

    if (prefersReducedMotion()) {
      map.setView([merchant.latitude, merchant.longitude], 16)
    } else {
      map.flyTo([merchant.latitude, merchant.longitude], 16, {
        duration: 0.8,
      })
    }

    markersRef.current?.eachLayer((layer) => {
      if (!(layer instanceof L.Marker)) return

      const position = layer.getLatLng()

      if (
        position.lat === merchant.latitude &&
        position.lng === merchant.longitude
      ) {
        layer.openPopup()
      }
    })
  }, [selectedMerchantId, merchants])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-ink bg-mist">
      <div
        ref={mapContainerRef}
        role="region"
        aria-label="Peta pedagang kopi di sekitar"
        className="h-[50vh] min-h-[320px] w-full bg-mist sm:h-[420px] lg:h-full"
      />
    </div>
  )
}

export default MapView
