import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'

type BrandFilterProps = {
  id: string
  brands: { brand: string; count: number }[]
  value: string
  allLabel: string
  isLoading: boolean
  error: string
  onChange: (brand: string) => void
}

// Combobox brand: semua brand aktif tetap tampil, dan pengguna bisa
// mengetik untuk menyaring tanpa membuka halaman lain.
export default function BrandFilter({
  id,
  brands,
  value,
  allLabel,
  isLoading,
  error,
  onChange,
}: BrandFilterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const options = useMemo(() => {
    const term = query.trim().toLowerCase()

    const matches = brands
      .map(({ brand }) => brand)
      .filter((brand) => brand.toLowerCase().includes(term))

    // "Semua brand" selalu di urutan atas supaya filter mudah direset,
    // termasuk saat pencarian tidak menemukan brand lain.
    return [allLabel, ...matches.filter((brand) => brand !== allLabel)]
  }, [brands, query, allLabel])

  const hasMatches = options.length > 1
  // Indeks disimpan di state, tapi bisa melebihi daftar setelah penyaringan,
  // jadi dijinakkan saat render alih-alih lewat efek.
  const activeIndex = Math.min(
    highlightedIndex,
    Math.max(options.length - 1, 0),
  )
  const activeOption =
    isOpen && hasMatches ? options[activeIndex] : undefined

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () =>
      document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  function openList() {
    if (isOpen) {
      return
    }

    setIsOpen(true)
    setQuery('')
    setHighlightedIndex(Math.max(options.indexOf(value), 0))
  }

  function closeList() {
    setIsOpen(false)
    setQuery('')
  }

  function selectOption(option: string) {
    onChange(option)
    closeList()
    inputRef.current?.blur()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()

      if (!isOpen) {
        openList()
        return
      }

      if (!hasMatches) {
        return
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex =
        (activeIndex + direction + options.length) % options.length

      setHighlightedIndex(nextIndex)
      return
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault()

      if (activeOption) {
        selectOption(activeOption)
      }

      return
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      event.stopPropagation()
      closeList()
      return
    }

    if (event.key === 'Home' && isOpen && hasMatches) {
      event.preventDefault()
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End' && isOpen && hasMatches) {
      event.preventDefault()
      setHighlightedIndex(options.length - 1)
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeOption ? `${listId}-${activeIndex}` : undefined
        }
        value={isOpen ? query : value}
        placeholder={isOpen ? value : undefined}
        onFocus={openList}
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlightedIndex(0)
          setIsOpen(true)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Pilihan diklik lewat onMouseDown yang membatalkan blur, jadi
          // blur di sini berarti fokus benar-benar pindah.
          closeList()
        }}
        className="brutal-input h-11 w-full appearance-none pl-3.5 pr-9 text-xs text-ink sm:h-12 sm:pl-4 sm:pr-10 sm:text-sm"
      />

      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isOpen) {
            closeList()
            return
          }

          inputRef.current?.focus()
          openList()
        }}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {isOpen && (
        <div
          id={listId}
          role="listbox"
          aria-label="Daftar kategori"
          onMouseDown={(event) => event.preventDefault()}
          className="absolute left-0 right-0 top-full z-[900] mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-[10px] border-2 border-ink bg-canvas p-1 shadow-brutal"
        >
          {isLoading && (
            <p role="status" className="px-2.5 py-2 text-xs text-muted">
              Memuat brand...
            </p>
          )}

          {!isLoading && error && (
            <p role="status" className="px-2.5 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          {!isLoading && !error && (
            <>
              {options.map((option, index) => {
                const isHighlighted = index === activeIndex
                const isSelected = option === value

                return (
                  <div
                    key={option}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectOption(option)}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs text-ink sm:text-sm ${
                      isHighlighted ? 'bg-mist font-bold' : ''
                    }`}
                  >
                    <span className="truncate">{option}</span>

                    {isSelected && (
                      <Check
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                        strokeWidth={2.5}
                      />
                    )}
                  </div>
                )
              })}

              {!hasMatches && (
                <p role="status" className="px-2.5 py-1.5 text-xs text-muted">
                  Tidak ada kategori lain yang cocok.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
