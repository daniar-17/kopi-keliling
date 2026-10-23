// Format waktu dan teks kecil yang dipakai lintas halaman.

// Menampilkan "baru saja", "2 mnt lalu", dan seterusnya untuk label
// kesegaran titik jualan.
export function formatRelativeTime(
  isoDate: string | null,
  now: number,
): string | null {
  if (!isoDate) {
    return null
  }

  const updatedAt = Date.parse(isoDate)

  if (Number.isNaN(updatedAt)) {
    return null
  }

  const elapsedMinutes = Math.max(0, Math.round((now - updatedAt) / 60000))

  if (elapsedMinutes < 1) {
    return 'baru saja'
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} mnt lalu`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)

  if (elapsedHours < 24) {
    return `${elapsedHours} jam lalu`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `${elapsedDays} hari lalu`
}
