import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { dateTime, type Row } from '@/lib/resources'

export const Route = createFileRoute('/_app/conversaciones/$id')({ component: Thread })

const WHO: Record<string, string> = { user: 'Cliente', assistant: 'Agente', staff: 'Personal' }

function Thread() {
  const { id } = Route.useParams()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['thread', id],
    queryFn: async () => (await api<Row[]>(`/messages?conversationId=${id}&limit=500`)).reverse(), // la API ordena del más nuevo al más viejo
    refetchInterval: 10_000,
  })
  const { data: conv } = useQuery({ queryKey: ['conversation', id], queryFn: () => api<Row>(`/conversations/${id}`) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['thread', id] }); qc.invalidateQueries({ queryKey: ['conversation', id] }); qc.invalidateQueries({ queryKey: ['conversations'] }) }
  const reply = useMutation({
    mutationFn: () => api(`/conversations/${id}/reply`, { method: 'POST', body: { text: text.trim() } }),
    onSuccess: () => { setText(''); refresh() },
    onError: (e: Error) => toast.error(e.message), // incluye el aviso de la ventana de 24 h
  })
  const handoff = useMutation({
    mutationFn: (escalated: number) => api(`/conversations/${id}`, { method: 'PATCH', body: { escalated } }),
    onSuccess: refresh, onError: (e: Error) => toast.error(e.message),
  })
  const byStaff = !!conv?.escalated

  return (
    <div className="space-y-6">
      <Link to="/$resource" params={{ resource: 'conversaciones' }} className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Conversaciones</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Hilo</h1>
        {conv && (
          <Button variant="outline" disabled={handoff.isPending} onClick={() => handoff.mutate(byStaff ? 0 : 1)}>
            {byStaff ? 'Devolver al agente' : 'Pasar al personal'}
          </Button>
        )}
      </div>
      {error ? <p role="alert">No pudimos cargar el hilo: {(error as Error).message}</p>
        : isLoading ? <p className="text-muted">Cargando…</p>
        : !data?.length ? <p className="text-muted">Sin mensajes.</p>
        : (
          <ol className="max-w-2xl space-y-3">
            {data.map((m) => (
              <li key={m.id} className={`rounded-lg border p-3 ${m.role === 'user' ? 'bg-paper-2' : 'bg-paper-3'}`}>
                <p className="text-xs text-muted">{WHO[m.role] ?? m.role} · {dateTime(m.createdAt)}</p>
                <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
              </li>
            ))}
          </ol>
        )}
      {conv?.channel === 'whatsapp' ? (
        <form className="max-w-2xl space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply.mutate() }}>
          <label htmlFor="reply" className="text-sm font-medium">Responder por WhatsApp</label>
          <textarea id="reply" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
            className="w-full rounded-md border border-input bg-paper-2 px-3 py-2 text-sm text-ink" />
          <p className="text-xs text-muted">Solo se puede escribir libremente dentro de las 24 horas posteriores al último mensaje del cliente.</p>
          <Button type="submit" disabled={reply.isPending || !text.trim()}><Send /> {reply.isPending ? 'Enviando…' : 'Enviar'}</Button>
        </form>
      ) : conv && <p className="text-sm text-muted">Las conversaciones del chat web no admiten respuesta por WhatsApp.</p>}
    </div>
  )
}
