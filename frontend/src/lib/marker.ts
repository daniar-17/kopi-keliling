// Warna default kalau pedagang belum punya markerColor.
const DEFAULT_MARKER_COLOR = '#92400e'
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

// Memilih warna marker yang valid; selain kode hex atau kosong memakai
// warna default. Dipakai saat memetakan data API.
export function resolveMarkerColor(markerColor?: string) {
  const value = markerColor?.trim()

  if (value && HEX_COLOR_PATTERN.test(value)) {
    return value
  }

  return DEFAULT_MARKER_COLOR
}

// Warna ikon di dalam marker dan di kotak logo kartu: tinta untuk latar
// terang, putih untuk latar gelap. Palet kategori yang lembut membuat
// ikon putih nyaris hilang, jadi kontras dihitung dari kecerahan warna.
export function resolveMarkerIconColor(markerColor?: string) {
  const value = resolveMarkerColor(markerColor).slice(1)
  const hex =
    value.length <= 4
      ? value
          .slice(0, 3)
          .split('')
          .map((character) => character + character)
          .join('')
      : value.slice(0, 6)

  const red = parseInt(hex.slice(0, 2), 16)
  const green = parseInt(hex.slice(2, 4), 16)
  const blue = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255

  return luminance > 0.6 ? '#111111' : '#ffffff'
}
