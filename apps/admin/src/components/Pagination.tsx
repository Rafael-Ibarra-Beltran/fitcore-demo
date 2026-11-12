import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const PAGE_SIZES = [10, 25, 50] as const

/** Páginas visibles: todas si caben, o 1 … vecinas … última. */
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const sorted = [...set].sort((a, b) => a - b)
  return sorted.flatMap((n, i) => (i && n - sorted[i - 1] > 1 ? ['…' as const, n] : [n]))
}

type Props = {
  total: number; page: number; size: number
  onPage: (page: number) => void
  onSize?: (size: number) => void // sin él no se muestra el selector de tamaño (versión compacta)
  label?: string // nombre del nav: debe ser único si hay varias paginaciones en la misma página
}

export function Pagination({ total, page, size, onPage, onSize, label = 'Paginación' }: Props) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (!total || (!onSize && pages === 1)) return null
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted" aria-live="polite">Mostrando {from} a {to} de {total}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onSize && (
          <label className="flex items-center gap-2 text-muted">
            Por página
            <select className="h-10 rounded-md border border-input bg-paper-2 px-2 text-ink" value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <Button variant="outline" size="icon" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        {pageList(page, pages).map((n, i) => n === '…'
          ? <span key={`gap${i}`} aria-hidden className="px-1 text-muted">…</span>
          : <Button key={n} variant={n === page ? 'default' : 'ghost'} size="icon" aria-label={`Página ${n}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</Button>)}
        <Button variant="outline" size="icon" aria-label="Página siguiente" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></Button>
      </div>
    </nav>
  )
}
