import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { mxn } from '@fitcore/shared'
import { TriangleAlert } from 'lucide-react'
import { Pagination } from '@/components/Pagination'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { meQuery } from '@/routes/_app'

export const Route = createFileRoute('/_app/')({ component: Dashboard })

type Stats = { members: number; newMembers: number; expiring: number; newLeads: number; revenueCents: number | null }
type Person = { id: string; name: string; phone: string; endsAt?: string; lastVisit?: string | null }
type Hour = { hour: string; peak: number }
type Now = { people: number; at: string; max: number; fresh: boolean; over: boolean } | null

const fecha = (v: string) => new Date(v.length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function Dashboard() {
  const me = useQuery(meQuery).data
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  const expiring = useQuery({ queryKey: ['expiring'], queryFn: () => api<Person[]>('/memberships/expiring?days=7') })
  const inactive = useQuery({ queryKey: ['inactive'], queryFn: () => api<Person[]>('/attendance/inactive?days=30') })
  const hourly = useQuery({ queryKey: ['hourly'], queryFn: () => api<Hour[]>('/occupancy/hourly?days=1') })
  const now = useQuery({ queryKey: ['occupancy-now'], queryFn: () => api<Now>('/occupancy/now'), refetchInterval: 30_000 })

  const s = stats.data
  const kpis: [string, string | number | undefined][] = [
    ['Socios activos', s?.members], ['Altas (30 días)', s?.newMembers], ['Vencen en 7 días', s?.expiring], ['Leads nuevos', s?.newLeads],
    ...(s && s.revenueCents !== null ? [['Ingresos (30 días)', mxn(s.revenueCents)] as [string, string]] : []),
  ]
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Resumen</h1>
        <p className="mt-2 text-lg text-ink-2">{greeting()}{me ? `, ${me.role === 'owner' ? 'dueño' : 'recepción'}` : ''}. Hoy es {hoy}.</p>
      </div>

      <section aria-label="Cifras" className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-paper-2 min-[60rem]:grid-cols-[repeat(auto-fit,minmax(0,1fr))] min-[60rem]:divide-y-0">
        {stats.error
          ? <div role="alert" className="col-span-full flex items-center justify-between gap-4 p-6 text-sm">No pudimos cargar las cifras. <Button variant="outline" onClick={() => stats.refetch()}>Reintentar</Button></div>
          : kpis.map(([label, value], i) => (
            <div key={label} className="rise p-6" style={{ '--i': i } as React.CSSProperties}>
              <p className="text-sm text-muted">{label}</p>
              {value === undefined ? <div className="skeleton mt-3 h-12 w-24" /> : <p className={`kpi mt-3 ${String(value).length > 6 ? 'kpi--long' : ''}`}>{value}</p>}
            </div>
          ))}
      </section>

      <OccupancyNow n={now.data} />

      <Occupancy q={hourly} />

      <div className="grid gap-6 min-[60rem]:grid-cols-2">
        <List title="Membresías por vencer" q={expiring} empty="Ninguna membresía vence esta semana." extra={(p) => fecha(p.endsAt!)} />
        <List title="Sin asistir en 30 días" q={inactive} empty="Todos los socios activos asistieron este mes." extra={(p) => (p.lastVisit ? `Última visita ${fecha(p.lastVisit)}` : 'Nunca')} />
      </div>
    </div>
  )
}

/** Aforo de la cámara: alerta al superar el máximo; si la lectura es vieja no se presenta como actual. */
function OccupancyNow({ n }: { n: Now | undefined }) {
  if (!n) return null
  if (n.over) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-[var(--color-error)] bg-paper-2 p-4">
        <TriangleAlert className="size-5 shrink-0 text-[var(--color-error)]" aria-hidden />
        <p><strong>Aforo al límite:</strong> {n.people} personas, el máximo es {n.max}.</p>
      </div>
    )
  }
  const hora = new Date(n.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })
  return (
    <p className="text-sm text-muted">
      {n.fresh ? `Ahora hay ${n.people} personas (aforo máximo ${n.max}).` : `Sin lectura reciente de la cámara (última: ${n.people} personas a las ${hora})`}
    </p>
  )
}

function Occupancy({ q }: { q: ReturnType<typeof useQuery<Hour[]>> }) {
  const data = q.data ?? []
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((h) => h.peak))
  const peak = data.reduce<Hour | null>((b, h) => (!b || h.peak > b.peak ? h : b), null)
  const avg = data.length ? Math.round(data.reduce((a, h) => a + h.peak, 0) / data.length) : 0
  const label = (h: Hour) => `${h.peak} personas a las ${h.hour.slice(11, 13)}:00`
  return (
    <section aria-labelledby="aforo" className="rounded-lg border bg-paper-2 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="aforo" className="text-2xl font-semibold">Aforo por hora (últimas 24 h)</h2>
        {peak && <p className="text-sm text-muted">Pico: <span className="font-semibold text-ink">{peak.peak} personas</span> a las {peak.hour.slice(11, 13)}:00</p>}
      </div>
      {q.error ? (
        <div role="alert" className="mt-6 flex items-center gap-4 text-sm">No pudimos cargar el aforo. <Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button></div>
      ) : q.isLoading ? (
        <div className="mt-6 flex h-80 items-end gap-2">{Array.from({ length: 16 }, (_, i) => <div key={i} className="skeleton flex-1" style={{ height: `${25 + ((i * 37) % 60)}%` }} />)}</div>
      ) : !data.length ? (
        <p className="mt-6 py-16 text-center text-sm text-muted">Aún no hay lecturas de ocupación. Aparecerán cuando la cámara envíe conteos.</p>
      ) : (
        <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <div className="flex h-80 flex-col justify-between text-xs text-muted" aria-hidden>{[max, Math.round(max * 0.75), Math.round(max / 2), Math.round(max / 4), 0].map((v, i) => <span key={i}>{v}</span>)}</div>
          <div className="relative h-80 border-b border-l" onMouseLeave={() => setActive(null)}>
            {[25, 50, 75, 100].map((p) => <div key={p} aria-hidden className="absolute inset-x-0 border-t border-dashed border-[var(--color-line)]" style={{ bottom: `${p}%` }} />)}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-[var(--color-ink-2)]" style={{ bottom: `${(avg / max) * 100}%` }}>
              <span className="absolute right-0 -translate-y-full bg-paper-2 px-2 text-xs text-ink-2">Promedio {avg}</span>
            </div>
            <div className="absolute inset-0 flex items-end gap-1.5 px-1.5">
              {data.map((h, i) => (
                <div key={h.hour} className="relative flex h-full flex-1 items-end">
                  <button type="button" aria-label={label(h)} data-peak={h === peak} className="bar w-full" style={{ height: `${(h.peak / max) * 100}%`, '--i': i } as React.CSSProperties}
                    onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
                  {active === i && (
                    <div role="tooltip" className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs whitespace-nowrap" style={{ bottom: `calc(${(h.peak / max) * 100}% + 8px)` }}>
                      <span className="font-semibold text-ink">{h.peak} personas</span> <span className="text-muted">a las {h.hour.slice(11, 13)}:00</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <span />
          <div className="mt-1.5 flex gap-1.5 px-1.5 text-xs text-muted">{data.map((h) => <span key={h.hour} className="flex-1 text-center">{h.hour.slice(11, 13)}</span>)}</div>
        </div>
      )}
    </section>
  )
}

const LIST_SIZE = 5

function List({ title, q, empty, extra }: { title: string; q: ReturnType<typeof useQuery<Person[]>>; empty: string; extra: (p: Person) => string }) {
  const rows = q.data ?? []
  const [page, setPage] = useState(1)
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / LIST_SIZE)))
  const shown = rows.slice((current - 1) * LIST_SIZE, current * LIST_SIZE)
  // Alto fijo: el cuerpo reserva 5 filas de 48 px y la franja del paginador siempre existe, así la tarjeta no cambia de tamaño al paginar.
  return (
    <section className="flex flex-col rounded-lg border bg-paper-2">
      <h2 className="border-b p-6 text-xl font-semibold">{title} {q.data && <span className="text-muted">({rows.length})</span>}</h2>
      <div className="min-h-60 flex-1">
        {q.error ? (
          <div role="alert" className="flex h-60 items-center justify-between gap-4 px-6 text-sm">No pudimos cargar esta lista. <Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button></div>
        ) : q.isLoading ? (
          <div className="space-y-3 p-6">{Array.from({ length: LIST_SIZE }, (_, i) => <div key={i} className="skeleton h-5" />)}</div>
        ) : !rows.length ? (
          <p className="flex h-60 items-center px-6 text-sm text-muted">{empty}</p>
        ) : (
          <ul className="divide-y text-sm">
            {shown.map((p) => (
              <li key={p.id} className="flex h-12 items-center justify-between gap-4 px-6">
                <span className="min-w-0 truncate">{p.name} <span className="text-muted">{p.phone}</span></span>
                <span className="shrink-0 text-ink-2">{extra(p)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex min-h-[73px] items-center border-t p-4">
        {rows.length > LIST_SIZE && <div className="w-full"><Pagination label={`Paginación de ${title.toLowerCase()}`} total={rows.length} page={current} size={LIST_SIZE} onPage={setPage} /></div>}
      </div>
    </section>
  )
}
