import { Combobox as C } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown } from 'lucide-react'

export type Option = { value: string; label: string }

/** Lista desplegable con búsqueda por texto (insensible a mayúsculas y acentos) para campos que pueden crecer. */
export function Combobox({ id, options, value, onChange, placeholder = 'Selecciona…', 'aria-label': label }: {
  id?: string; options: Option[]; value: string; onChange: (value: string) => void; placeholder?: string; 'aria-label'?: string
}) {
  const selected = options.find((o) => o.value === value) ?? null
  return (
    <C.Root items={options} value={selected} onValueChange={(o: Option | null) => onChange(o?.value ?? '')}>
      <C.InputGroup className="relative">
        <C.Input id={id} aria-label={label} placeholder={placeholder} autoComplete="off"
          className="h-10 w-full rounded-md border border-input bg-paper-2 pr-10 pl-3 text-sm text-ink placeholder:text-muted" />
        <C.Trigger aria-label="Abrir lista" className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink">
          <ChevronsUpDown className="size-4" />
        </C.Trigger>
      </C.InputGroup>
      <C.Portal>
        <C.Positioner sideOffset={4} className="z-[70]">
          <C.Popup className="w-(--anchor-width) max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-[var(--color-rule)] bg-popover text-sm text-popover-foreground">
            <C.Empty className="p-3 text-muted empty:hidden">Sin resultados</C.Empty>
            <C.List className="max-h-72 overflow-y-auto p-1">
              {(o: Option) => (
                <C.Item key={o.value} value={o} className="flex min-h-10 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none data-highlighted:bg-paper-3 data-highlighted:text-ink">
                  <span className="grid size-4 place-items-center"><C.ItemIndicator><Check className="size-4 text-[var(--color-accent)]" /></C.ItemIndicator></span>
                  <span className="min-w-0 truncate">{o.label}</span>
                </C.Item>
              )}
            </C.List>
          </C.Popup>
        </C.Positioner>
      </C.Portal>
    </C.Root>
  )
}
