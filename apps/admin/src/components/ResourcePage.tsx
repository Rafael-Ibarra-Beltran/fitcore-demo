import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Pagination } from '@/components/Pagination'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { refLabel, type Field, type Lookups, type RefKind, type Resource, type Row } from '@/lib/resources'
import { meQuery } from '@/routes/_app'

const REF_PATH: Record<RefKind, string> = { members: 'members', plans: 'plans', classes: 'classes', memberships: 'memberships' }
const selectCls = 'h-10 w-full rounded-md border border-input bg-paper-2 px-3 text-sm text-ink'

function useLookups(): Lookups {
  const kinds = Object.keys(REF_PATH) as RefKind[]
  const res = useQueries({ queries: kinds.map((k) => ({ queryKey: [k], queryFn: () => api<Row[]>(`/${REF_PATH[k]}?limit=500`) })) })
  return Object.fromEntries(kinds.map((k, i) => [k, res[i].data ?? []])) as Lookups
}

const localInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

/** Convierte lo capturado en el formulario al cuerpo que espera el servidor. */
function toPayload(fields: Field[], v: Row): Row {
  const out: Row = {}
  for (const f of fields) {
    const raw = v[f.name]
    if (raw === '' || raw === undefined) { if (!f.optional) out[f.name] = f.type === 'number' ? NaN : raw; continue }
    out[f.name] = f.type === 'number' ? Math.round(Number(raw) * (f.scale ?? 1)) : f.type === 'datetime' ? new Date(raw).toISOString() : raw
  }
  return out
}

type Filter = { q?: string; status?: string; page?: number; size?: number }
const find = (rows: Row[], id: string) => rows.find((r) => r.id === id)

/** Texto en el que busca el cuadro de búsqueda: los valores de la fila y los nombres de lo que referencia. */
function haystack(row: Row, l: Lookups) {
  return [
    ...Object.values(row).filter((v) => typeof v === 'string' || typeof v === 'number'),
    find(l.members, row.memberId)?.name, find(l.classes, row.classId)?.name, find(l.plans, row.planId)?.name,
    find(l.members, find(l.memberships, row.membershipId)?.memberId)?.name,
  ].join(' ').toLowerCase()
}

export function ResourcePage({ r, path, q, status, page, size, onFilter }: { r: Resource; path: string; q: string; status: string; page: number; size: number; onFilter: (f: Filter) => void }) {
  const qc = useQueryClient()
  const { data: me } = useQuery(meQuery)
  const lookups = useLookups()
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: [path], queryFn: () => api<Row[]>(`/${path}?limit=500`) })
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<Row | null>(null)
  const canWrite = !r.ownerWrite || me?.role === 'owner'
  const canCreate = canWrite && !r.noCreate
  // La columna de acciones solo existe si alguna fila puede tener una (evita una cabecera "Acciones" vacía).
  const hasActions = canWrite && (!r.noEdit || !r.noDelete || !!r.actions?.length)

  const needle = q.trim().toLowerCase()
  const visible = rows.filter((row) => (!status || row.status === status) && (!needle || haystack(row, lookups).includes(needle)))
  const filtered = !!(needle || status)
  const pages = Math.max(1, Math.ceil(visible.length / size))
  const current = Math.min(page, pages) // si tras eliminar la página ya no existe, cae a la última
  const shown = visible.slice((current - 1) * size, current * size)

  const refresh = () => { qc.invalidateQueries({ queryKey: [path] }); qc.invalidateQueries({ queryKey: ['stats'] }) }
  const fail = (e: Error) => toast.error(e.message)
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Row }) => api(id ? `/${path}/${id}` : `/${path}`, { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: () => { toast.success('Guardado'); setEditing(null); refresh() }, onError: fail,
  })
  const act = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Row }) => api(`/${path}/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh, onError: fail,
  })
  const del = useMutation({
    mutationFn: (id: string) => api(`/${path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Eliminado'); setToDelete(null); refresh() }, onError: fail,
  })
  const tool = useMutation({
    mutationFn: (t: NonNullable<Resource['toolbar']>[number]) => api(t.path, { method: 'POST', body: {} }).then((d) => ({ t, d })),
    onSuccess: ({ t, d }) => { toast.success(t.done(d)); refresh() }, onError: fail,
  })
  const cols = r.columns.length + (hasActions ? 1 : 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{r.title}</h1>
          <p className="mt-1 text-sm text-muted">{isLoading ? 'Cargando…' : filtered ? `${visible.length} de ${rows.length}` : `${rows.length} en total`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && r.toolbar?.map((t) => (
            <Button key={t.path} size="lg" variant="outline" disabled={tool.isPending} onClick={() => tool.mutate(t)}><RefreshCw /> {tool.isPending && tool.variables?.path === t.path ? 'Ejecutando…' : t.label}</Button>
          ))}
          {canCreate && <Button size="lg" onClick={() => setEditing('new')}><Plus /> {r.fem ? 'Nueva' : 'Nuevo'} {r.singular}</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-56 flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label={`Buscar en ${r.title.toLowerCase()}`} placeholder="Buscar" className="pl-9" value={q} onChange={(e) => onFilter({ q: e.target.value || undefined, page: undefined })} />
        </div>
        {r.statuses && (
          <select aria-label="Filtrar por estado" className={`${selectCls.replace('w-full', 'w-48')}`} value={status} onChange={(e) => onFilter({ status: e.target.value || undefined, page: undefined })}>
            <option value="">Todos los estados</option>
            {r.statuses.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {filtered && <Button variant="ghost" onClick={() => onFilter({ q: undefined, status: undefined, page: undefined })}>Limpiar filtros</Button>}
      </div>

      {error ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-paper-2 p-6">
          <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4 text-[var(--color-error)]" /> No pudimos cargar {r.title.toLowerCase()}.</p>
          <p className="text-sm text-muted">{(error as Error).message}. Revisa tu conexión y vuelve a intentar.</p>
          <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-paper-2">
          <Table className="data-table">
            <TableHeader><TableRow>
              {r.columns.map((c) => <TableHead key={c.label} className="px-4">{c.label}</TableHead>)}
              {hasActions && <TableHead className="px-4 text-right">Acciones</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>{Array.from({ length: cols }, (_, j) => <TableCell key={j} className="px-4"><div className="skeleton h-4" style={{ width: `${55 + ((i + j) % 4) * 10}%` }} /></TableCell>)}</TableRow>
              ))}
              {!isLoading && !visible.length && (
                <TableRow><TableCell colSpan={cols} className="px-4 py-12 text-center">
                  <p className="font-semibold">{filtered ? 'Sin resultados con estos filtros' : `Aún no hay ${r.title.toLowerCase()}`}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{filtered ? 'Prueba con otra búsqueda o quita los filtros.' : `Cuando agregues ${r.singular === 'entrada' ? 'entradas' : r.singular + 's'} aparecerán aquí.`}</p>
                  {filtered
                    ? <Button className="mt-4" variant="outline" onClick={() => onFilter({ q: undefined, status: undefined, page: undefined })}>Limpiar filtros</Button>
                    : canCreate && <Button className="mt-4" onClick={() => setEditing('new')}><Plus /> {r.fem ? 'Nueva' : 'Nuevo'} {r.singular}</Button>}
                </TableCell></TableRow>
              )}
              {shown.map((row, i) => (
                <TableRow key={row.id} className="rise hover:bg-paper-3" style={{ '--i': Math.min(i, 11) } as React.CSSProperties}>
                  {r.columns.map((c) => <TableCell key={c.label} className="px-4">{c.cell(row, lookups)}</TableCell>)}
                  {hasActions && (
                    <TableCell className="space-x-2 whitespace-nowrap px-4 text-right">
                      {r.actions?.filter((a) => a.when(row)).map((a) => (
                        <Button key={a.label} size="sm" variant="outline" onClick={() => act.mutate({ id: row.id, body: a.patch })}>{a.label}</Button>
                      ))}
                      {!r.noEdit && <Button size="sm" variant="outline" onClick={() => setEditing(row)}>Editar</Button>}
                      {!r.noDelete && <Button size="sm" variant="ghost" className="text-[var(--color-error)]" onClick={() => setToDelete(row)}>Eliminar</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!error && !isLoading && (
        <Pagination total={visible.length} page={current} size={size} onPage={(n) => onFilter({ page: n })} onSize={(n) => onFilter({ size: n, page: undefined })} />
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing === 'new' ? `${r.fem ? 'Nueva' : 'Nuevo'} ${r.singular}` : `Editar ${r.singular}`}</DialogTitle></DialogHeader>
          {editing && (
            <RowForm r={r} lookups={lookups} row={editing === 'new' ? null : editing} busy={save.isPending}
              onSubmit={(body) => save.mutate({ id: editing === 'new' ? undefined : editing.id, body })} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar este {r.singular}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted">Esta acción no se puede deshacer.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={del.isPending} onClick={() => toDelete && del.mutate(toDelete.id)}>Eliminar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RowForm({ r, lookups, row, busy, onSubmit }: { r: Resource; lookups: Lookups; row: Row | null; busy: boolean; onSubmit: (b: Row) => void }) {
  // La validación es la misma de la API (esquema Zod compartido).
  const resolver: Resolver<Row> = async (values) => {
    const payload = toPayload(r.fields, values)
    const res = r.schema.safeParse(payload)
    if (res.success) return { values: payload, errors: {} }
    const errors: Row = {}
    for (const i of res.error.issues) errors[String(i.path[0])] ??= { type: 'zod', message: i.message }
    return { values: {}, errors }
  }
  const defaults = Object.fromEntries(r.fields.map((f) => {
    const v = row?.[f.name]
    return [f.name, v == null ? (f.type === 'select' ? f.options![0][0] : '') : f.type === 'number' ? v / (f.scale ?? 1) : f.type === 'datetime' ? localInput(v) : v]
  }))
  const { register, control, handleSubmit, formState: { errors } } = useForm<Row>({ resolver, defaultValues: defaults })

  return (
    <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
      {r.fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          {f.type === 'select' && (
            <select id={f.name} className={selectCls} {...register(f.name)}>
              {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {f.type === 'ref' && (
            <Controller name={f.name} control={control} render={({ field }) => (
              <Combobox id={f.name} aria-label={f.label} value={field.value ?? ''} onChange={field.onChange}
                options={lookups[f.ref!].map((o) => ({ value: o.id, label: refLabel(f.ref!, o, lookups) }))} />
            )} />
          )}
          {f.type === 'textarea' && <textarea id={f.name} rows={8} className={`${selectCls} h-auto py-2`} {...register(f.name)} />}
          {!['select', 'ref', 'textarea'].includes(f.type) && (
            <Input id={f.name} step={f.scale ? '0.01' : undefined}
              type={{ text: 'text', number: 'number', date: 'date', datetime: 'datetime-local' }[f.type as 'text']} {...register(f.name)} />
          )}
          {errors[f.name] && <p className="text-xs text-destructive">{String(errors[f.name]!.message)}</p>}
        </div>
      ))}
      <Button type="submit" size="lg" disabled={busy} className="w-full">Guardar</Button>
    </form>
  )
}
