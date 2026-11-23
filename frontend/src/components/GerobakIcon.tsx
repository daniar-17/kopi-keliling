type GerobakIconProps = {
  size?: number | string
  color?: string
  strokeWidth?: number
  className?: string
}

// Ikon gerobak keliling bergaya garis, mengikuti gambar acuan: tenda
// bergerigi, sekat tenda, dua tiang, badan gerobak, dan dua roda berhub.
// Jumlah gerigi dan sekat dikurangi dari acuan supaya tetap terbaca saat
// diperkecil ke marker 19px.
export default function GerobakIcon({
  size = 24,
  color = 'currentColor',
  strokeWidth = 1.5,
  className,
}: GerobakIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Tenda: sisi miring dan gerigi bawah. */}
      <path d="M4.5 3h15l2 4.2h-19L4.5 3Z" />
      <path d="M2.5 7.2a2.375 2.375 0 0 0 4.75 0 2.375 2.375 0 0 0 4.75 0 2.375 2.375 0 0 0 4.75 0 2.375 2.375 0 0 0 4.75 0" />

      {/* Sekat tenda. */}
      <path d="M8.25 3 7.25 7.2M12 3l-1 4.2M15.75 3l-1 4.2" />

      {/* Tiang tenda ke badan. */}
      <path d="M6.2 9.6v2.8M18 9.6v2.8" />

      {/* Badan gerobak. */}
      <rect x="5" y="12.4" width="14" height="6.2" rx="0.8" />

      {/* As roda. */}
      <path d="M8.4 19.9h7.2" />

      {/* Roda dan hub. */}
      <circle cx="8.4" cy="19.9" r="1.9" />
      <circle cx="15.6" cy="19.9" r="1.9" />
      <circle cx="8.4" cy="19.9" r="0.5" fill={color} stroke="none" />
      <circle cx="15.6" cy="19.9" r="0.5" fill={color} stroke="none" />
    </svg>
  )
}
