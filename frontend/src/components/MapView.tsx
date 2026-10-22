
import { useEffect, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Coffee } from 'lucide-react'
import L from 'leaflet'

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

// Warna default kalau pedagang belum punya markerColor.
const DEFAULT_MARKER_COLOR = '#92400e'
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function resolveMarkerColor(markerColor?: string) {
  const value = markerColor?.trim()

  if (value && HEX_COLOR_PATTERN.test(value)) {
    return value
  }

  return DEFAULT_MARKER_COLOR
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

// Marker pedagang memakai warna data per brand. Marker yang dipilih
// dibuat sedikit lebih besar dengan cincin hijau sebagai penanda aktif.
function createMerchantIcon(
  markerColor: string,
  isSelected: boolean,
) {
  const size = isSelected ? 42 : 38
  const iconSize = isSelected ? 21 : 19
  const shadow = isSelected
    ? '0 0 0 3px #0c9b62, 0 2px 6px rgba(32, 41, 35, 0.28)'
    : '0 2px 5px rgba(32, 41, 35, 0.28)'

  const coffeeGlyph = renderToStaticMarkup(
    <Coffee
      size={iconSize}
      strokeWidth={2}
      color="#ffffff"
      aria-hidden="true"
    />,
  )

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${markerColor};
        border: 3px solid white;
        border-radius: 50% 50% 50% 8px;
        transform: rotate(-45deg);
        box-shadow: ${shadow};
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          transform: rotate(45deg);
          display: flex;
          line-height: 0;
        ">${coffeeGlyph}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
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
  const userMarkerRef = useRef<L.CircleMarker | null>(null)

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

    return () => {
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
      userMarkerRef.current = L.circleMarker(
        [latitude, longitude],
        {
          radius: 8,
          color: '#ffffff',
          weight: 3,
          fillColor: '#0c9b62',
          fillOpacity: 1,
        },
      ).addTo(map)

      userMarkerRef.current.bindPopup('Lokasi kamu')
    }

    // Langsung arahkan peta ke lokasi pengguna yang baru didapat.
    if (prefersReducedMotion()) {
      map.setView([latitude, longitude], 16)
    } else {
      map.flyTo([latitude, longitude], 16, { duration: 0.9 })
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

  const legendColors = Array.from(
    new Set(
      merchants.map((merchant) =>
        resolveMarkerColor(merchant.markerColor),
      ),
    ),
  ).slice(0, 4)

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-canvas">
      <div
        ref={mapContainerRef}
        role="region"
        aria-label="Peta pedagang kopi di sekitar"
        className="h-64 w-full bg-mist sm:h-[420px] lg:h-[520px]"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2.5 text-xs text-muted sm:gap-x-5 sm:gap-y-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex items-center -space-x-1"
          >
            {(legendColors.length > 0
              ? legendColors
              : [DEFAULT_MARKER_COLOR]
            ).map((color) => (
              <span
                key={color}
                className="h-2.5 w-2.5 rounded-full ring-1 ring-canvas"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
          Warna titik: pedagang
        </div>

        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-brand"
          />
          Lokasi kamu
        </div>

        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-soft ring-2 ring-brand"
          >
            <Coffee
              className="h-2.5 w-2.5 text-brand-strong"
              strokeWidth={2}
            />
          </span>
          Pedagang dipilih
        </div>
      </div>
    </div>
  )
}

export default MapView
