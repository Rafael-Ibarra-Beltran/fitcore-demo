import { useEffect, useRef, useState } from 'react'
import { publicLeadInput } from '@fitcore/shared'

const API = (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000')
const SITEKEY = (import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA')

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: { sitekey: string; theme?: string; appearance?: string; callback: (t: string) => void }) => void } } }

export default function LeadForm() {
  const box = useRef<HTMLDivElement>(null)
  const token = useRef('')
  const [state, setState] = useState<'idle' | 'sending' | 'ok'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.onload = () => box.current && window.turnstile?.render(box.current, { sitekey: SITEKEY, theme: 'dark', appearance: 'interaction-only', callback: (t) => { token.current = t } })
    document.head.appendChild(s)
  }, [])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const fields = { name: f.get('name'), phone: String(f.get('phone')).replace(/[\s-]/g, '') }
    const parsed = publicLeadInput.safeParse(fields)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setError(''); setState('sending')
    // Turnstile genera su token en segundo plano: si se envía antes de que llegue, el servidor lo rechaza. Se espera hasta 5 s.
    for (let i = 0; i < 50 && !token.current; i++) await new Promise((r) => setTimeout(r, 100))
    const r = await fetch(`${API}/api/public/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...parsed.data, turnstileToken: token.current }) }).catch(() => null)
    if (r?.ok) return setState('ok')
    setState('idle')
    setError(r?.status === 429 ? 'Demasiados intentos, espera un minuto.' : 'No pudimos enviar tus datos. Intenta de nuevo o escríbenos por WhatsApp.')
  }

  if (state === 'ok') return <p role="status" className="form__ok">¡Gracias! Te escribiremos muy pronto por WhatsApp.</p>
  return (
    <form onSubmit={submit} className="form" noValidate>
      <label className="field">Nombre<input name="name" required autoComplete="name" /></label>
      <label className="field">WhatsApp<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="55 1234 5678" /></label>
      <div ref={box} className="turnstile" />
      {error && <p role="alert" className="form__error">{error}</p>}
      <button disabled={state === 'sending'} className="btn">{state === 'sending' ? 'Enviando…' : 'Quiero mi clase de prueba'}</button>
    </form>
  )
}
