import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { meQuery } from '../_app'
import { z } from 'zod'
import { ResourcePage } from '@/components/ResourcePage'
import { RESOURCES } from '@/lib/resources'

const slugPath: Record<string, string> = { socios: 'members', planes: 'plans', membresias: 'memberships', pagos: 'payments', clases: 'classes', reservas: 'bookings', asistencia: 'attendance', leads: 'leads', conversaciones: 'conversations', conocimiento: 'kb', automatizaciones: 'automation-log' }

// Búsqueda y filtro viven en la URL: se pueden compartir y sobreviven a recargar.
const search = z.object({
  q: z.coerce.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
  size: z.union([z.literal(10), z.literal(25), z.literal(50)]).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/$resource')({
  validateSearch: search,
  component: () => {
    const { resource } = Route.useParams()
    const { q, status, page, size } = Route.useSearch()
    const nav = useNavigate({ from: Route.fullPath })
    const { data: me } = useQuery(meQuery)
    const r = RESOURCES[resource]
    if (r?.ownerOnly && me?.role !== 'owner') return <p>No tienes acceso a esta sección.</p>
    return r ? (
      <ResourcePage
        key={resource} r={r} path={slugPath[resource]} q={q ?? ''} status={status ?? ''} page={page ?? 1} size={size ?? 10}
        onFilter={(next) => nav({ search: (prev) => ({ ...prev, ...next } as typeof prev), replace: true })}
      />
    ) : <p>Página no encontrada.</p>
  },
})
