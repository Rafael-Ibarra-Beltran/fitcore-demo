import * as S from '@fitcore/shared'
import { mxn } from '@fitcore/shared'
import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { BookOpen, CalendarCheck, Zap, CalendarDays, CreditCard, IdCard, Megaphone, MessageSquare, ScanLine, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { z, type ZodType } from 'zod'

export type Row = Record<string, any>
export type RefKind = 'members' | 'plans' | 'classes' | 'memberships'
export type Lookups = Record<RefKind, Row[]>

export type Field = {
  name: string; label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'ref'
  options?: [string, string][]; ref?: RefKind
  scale?: number // p. ej. 100: el usuario captura pesos y se guardan centavos
  createOnly?: boolean; optional?: boolean
}
export type Resource = {
  title: string; singular: string; icon: typeof Users; schema: ZodType
  fields: Field[]; columns: { label: string; cell: (r: Row, l: Lookups) => ReactNode }[]
  ownerOnly?: boolean // oculto para recepción
  ownerWrite?: boolean // recepción solo lectura
  noEdit?: boolean
  noCreate?: boolean // se crean desde fuera (p. ej. el agente)
  noDelete?: boolean
  toolbar?: { label: string; path: string; done: (d: any) => string }[] // acciones del servidor (POST) junto al botón de alta
  statuses?: [string, string][] // valores del campo `status` para el filtro
  fem?: boolean // género gramatical: "Nueva" en vez de "Nuevo"
  actions?: { label: string; patch: Row; when: (r: Row) => boolean }[]
}

const date = (v: string) => new Date(v.length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
export const dateTime = (v: string) => new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
const find = (rows: Row[], id: string) => rows.find((r) => r.id === id)
export const memberName = (l: Lookups, id: string) => find(l.members, id)?.name ?? '—'
export const refLabel = (kind: RefKind, row: Row, l: Lookups): string => {
  switch (kind) {
    case 'members': return `${row.name} · ${row.phone}`
    case 'plans': return `${row.name} (${mxn(row.priceCents)})`
    case 'classes': return `${row.name} · ${dateTime(row.startsAt)}`
    case 'memberships': return `${memberName(l, row.memberId)} · ${find(l.plans, row.planId)?.name ?? ''} · vence ${date(row.endsAt)}`
  }
}
const TONE: Record<string, string> = { activo: 'good', activa: 'good', convertido: 'good', asistio: 'good', reservada: 'live', nuevo: 'live', inactivo: 'bad', personal: 'bad', agente: 'good', vencida: 'bad', cancelada: 'bad' }
const pill = (v: string) => <span className="status" data-tone={TONE[v]}>{v === 'asistio' ? 'asistió' : v}</span>

const JOBS: [string, string][] = [
  ['recordatorio-vencimiento', 'Vencimientos'], ['bienvenida', 'Bienvenida'], ['reactivacion', 'Reactivación'],
  ['seguimiento-lead', 'Seguimiento de leads'], ['resumen-semanal', 'Resumen semanal'],
]

export const RESOURCES: Record<string, Resource> = {
  socios: {
    title: 'Socios', singular: 'socio', statuses: [['activo', 'Activo'], ['inactivo', 'Inactivo']], icon: Users, schema: S.memberInput,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text' },
      { name: 'phone', label: 'WhatsApp (con lada)', type: 'text' },
      { name: 'status', label: 'Estado', type: 'select', options: [['activo', 'Activo'], ['inactivo', 'Inactivo']] },
    ],
    columns: [
      { label: 'Nombre', cell: (r) => r.name }, { label: 'WhatsApp', cell: (r) => r.phone },
      { label: 'Estado', cell: (r) => pill(r.status) }, { label: 'Alta', cell: (r) => date(r.joinedAt) },
    ],
  },
  planes: {
    title: 'Planes', singular: 'plan', icon: IdCard, schema: S.planInput, ownerWrite: true,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text' },
      { name: 'priceCents', label: 'Precio (MXN)', type: 'number', scale: 100 },
      { name: 'durationDays', label: 'Duración (días)', type: 'number' },
    ],
    columns: [
      { label: 'Plan', cell: (r) => r.name }, { label: 'Precio', cell: (r) => mxn(r.priceCents) },
      { label: 'Duración', cell: (r) => `${r.durationDays} días` },
    ],
  },
  membresias: {
    title: 'Membresías', singular: 'membresía', fem: true, statuses: [['activa', 'Activa'], ['vencida', 'Vencida'], ['cancelada', 'Cancelada']], icon: CalendarCheck, schema: S.membershipInput, noEdit: true,
    fields: [
      { name: 'memberId', label: 'Socio', type: 'ref', ref: 'members' },
      { name: 'planId', label: 'Plan', type: 'ref', ref: 'plans' },
      { name: 'startsAt', label: 'Inicio', type: 'date', optional: true },
    ],
    columns: [
      { label: 'Socio', cell: (r, l) => memberName(l, r.memberId) }, { label: 'Plan', cell: (r, l) => find(l.plans, r.planId)?.name },
      { label: 'Inicio', cell: (r) => date(r.startsAt) }, { label: 'Vence', cell: (r) => date(r.endsAt) },
      { label: 'Estado', cell: (r) => pill(r.status) },
    ],
    actions: [{ label: 'Cancelar', patch: { status: 'cancelada' }, when: (r) => r.status === 'activa' }],
  },
  pagos: {
    title: 'Pagos', singular: 'pago', icon: CreditCard, schema: S.paymentInput, ownerOnly: true, ownerWrite: true, noEdit: true,
    fields: [
      { name: 'membershipId', label: 'Membresía', type: 'ref', ref: 'memberships' },
      { name: 'amountCents', label: 'Monto (MXN)', type: 'number', scale: 100 },
      { name: 'method', label: 'Método', type: 'select', options: [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia']] },
    ],
    columns: [
      { label: 'Socio', cell: (r, l) => memberName(l, find(l.memberships, r.membershipId)?.memberId) },
      { label: 'Monto', cell: (r) => mxn(r.amountCents) }, { label: 'Método', cell: (r) => pill(r.method) },
      { label: 'Fecha', cell: (r) => date(r.paidAt) },
    ],
  },
  clases: {
    title: 'Clases', singular: 'clase', fem: true, icon: CalendarDays, schema: S.classInput,
    fields: [
      { name: 'name', label: 'Clase', type: 'text' }, { name: 'instructor', label: 'Instructor', type: 'text' },
      { name: 'startsAt', label: 'Fecha y hora', type: 'datetime' }, { name: 'capacity', label: 'Cupo', type: 'number' },
    ],
    columns: [
      { label: 'Clase', cell: (r) => r.name }, { label: 'Instructor', cell: (r) => r.instructor },
      { label: 'Horario', cell: (r) => dateTime(r.startsAt) }, { label: 'Cupo', cell: (r) => r.capacity },
    ],
  },
  reservas: {
    title: 'Reservas', singular: 'reserva', fem: true, statuses: [['reservada', 'Reservada'], ['asistio', 'Asistió'], ['cancelada', 'Cancelada']], icon: CalendarCheck, schema: S.bookingInput, noEdit: true,
    fields: [
      { name: 'classId', label: 'Clase', type: 'ref', ref: 'classes' },
      { name: 'memberId', label: 'Socio', type: 'ref', ref: 'members' },
    ],
    columns: [
      { label: 'Clase', cell: (r, l) => find(l.classes, r.classId)?.name }, { label: 'Horario', cell: (r, l) => { const c = find(l.classes, r.classId); return c ? dateTime(c.startsAt) : '—' } },
      { label: 'Socio', cell: (r, l) => memberName(l, r.memberId) }, { label: 'Estado', cell: (r) => pill(r.status) },
    ],
    actions: [
      { label: 'Asistió', patch: { status: 'asistio' }, when: (r) => r.status === 'reservada' },
      { label: 'Cancelar', patch: { status: 'cancelada' }, when: (r) => r.status === 'reservada' },
    ],
  },
  asistencia: {
    title: 'Asistencia', singular: 'entrada', fem: true, icon: ScanLine, schema: S.attendanceInput, noEdit: true,
    fields: [{ name: 'memberId', label: 'Socio', type: 'ref', ref: 'members' }],
    columns: [{ label: 'Socio', cell: (r, l) => memberName(l, r.memberId) }, { label: 'Entrada', cell: (r) => dateTime(r.checkedInAt) }],
  },
  leads: {
    title: 'Leads', singular: 'lead', statuses: [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['convertido', 'Convertido']], icon: Megaphone, schema: S.leadInput,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text' }, { name: 'phone', label: 'WhatsApp (con lada)', type: 'text' },
      { name: 'source', label: 'Origen', type: 'select', options: [['landing', 'Landing'], ['whatsapp', 'WhatsApp']] },
      { name: 'status', label: 'Estado', type: 'select', options: [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['convertido', 'Convertido']] },
    ],
    columns: [
      { label: 'Nombre', cell: (r) => r.name }, { label: 'WhatsApp', cell: (r) => r.phone },
      { label: 'Origen', cell: (r) => pill(r.source) }, { label: 'Estado', cell: (r) => pill(r.status) },
      { label: 'Fecha', cell: (r) => date(r.createdAt) },
    ],
  },
  conocimiento: {
    title: 'Conocimiento', singular: 'documento', icon: BookOpen, schema: S.kbDocumentInput, ownerWrite: true,
    toolbar: [{ label: 'Reindexar', path: '/kb/reindex', done: (d) => `${d.chunks} fragmentos indexados` }],
    fields: [{ name: 'title', label: 'Título', type: 'text' }, { name: 'content', label: 'Contenido', type: 'textarea' }],
    columns: [
      { label: 'Título', cell: (r) => r.title },
      { label: 'Contenido', cell: (r) => <span className="line-clamp-2 max-w-xl text-muted">{r.content}</span> },
      { label: 'Alta', cell: (r) => date(r.createdAt) },
    ],
  },
  automatizaciones: {
    title: 'Automatizaciones', singular: 'registro', icon: Zap, schema: z.object({}), fields: [], ownerOnly: true, ownerWrite: true, noCreate: true, noEdit: true, noDelete: true,
    toolbar: JOBS.map(([name, label]) => ({
      label: `Ejecutar: ${label}`, path: `/automations/${name}/run`,
      done: (d) => `${d.total} destinatarios · ${d.sent + d.simulated} enviados (${d.simulated} simulados) · ${d.skipped} omitidos · ${d.errors} con error`,
    })),
    columns: [
      { label: 'Tarea', cell: (r) => JOBS.find(([n]) => n === r.type)?.[1] ?? r.type },
      { label: 'Destinatario', cell: (r) => r.recipient },
      { label: 'Resultado', cell: (r) => (
        <span title={r.result}><span className="status" data-tone={r.result === 'enviado' ? 'good' : r.result === 'simulado' || r.result === 'pendiente' ? 'live' : 'bad'}>{r.result.startsWith('error') ? 'error' : r.result}</span></span>
      ) },
      { label: 'Fecha', cell: (r) => dateTime(r.at) },
    ],
  },
  conversaciones: {
    title: 'Conversaciones', singular: 'conversación', fem: true, icon: MessageSquare, schema: S.conversationInput, fields: [], noEdit: true, noCreate: true, noDelete: true,
    columns: [
      { label: 'Contacto', cell: (r, l) => r.memberId ? memberName(l, r.memberId) : r.leadId ? 'Lead' : 'Visitante web' },
      { label: 'Canal', cell: (r) => r.channel === 'whatsapp' ? 'WhatsApp' : 'Web' },
      { label: 'Atiende', cell: (r) => pill(r.escalated ? 'personal' : 'agente') },
      { label: 'Inicio', cell: (r) => dateTime(r.createdAt) },
      { label: 'Hilo', cell: (r) => <Link to="/conversaciones/$id" params={{ id: r.id }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Ver hilo</Link> },
    ],
    actions: [
      { label: 'Pasar al personal', patch: { escalated: 1 }, when: (r) => !r.escalated },
      { label: 'Devolver al agente', patch: { escalated: 0 }, when: (r) => !!r.escalated },
    ],
  },
}
