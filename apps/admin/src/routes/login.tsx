import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { APP_NAME } from '@fitcore/shared'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const done = { onSuccess: () => nav({ to: '/' }), onError: (e: Error) => toast.error(e.message === 'Error' ? 'Credenciales inválidas' : e.message) }
  const login = useMutation({ mutationFn: () => api('/auth/sign-in/email', { method: 'POST', body: { email, password } }), ...done })
  const demo = useMutation({ mutationFn: () => api('/public/demo/login', { method: 'POST', body: {} }), ...done })

  // Con "reducir movimiento" el video arranca pausado.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { video.current?.pause(); setPaused(true) }
  }, [])
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) { v.play().catch(() => {}); setPaused(false) } else { v.pause(); setPaused(true) } }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-clip p-4">
      <video ref={video} className="absolute inset-0 size-full object-cover" src="/media/login.mp4" poster="/media/login.webp" autoPlay muted loop playsInline aria-hidden="true" />
      <div className="login-veil absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="space-y-6 rounded-lg border bg-paper-2 p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo className="h-12 w-auto text-ink" />
            <h1 className="page-title !text-4xl">{APP_NAME} Panel</h1>
            <p className="text-sm text-muted">Inicia sesión para administrar tu gimnasio.</p>
          </div>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); login.mutate() }}>
            <div className="space-y-1.5"><Label htmlFor="email">Correo</Label>
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pw">Contraseña</Label>
              <Input id="pw" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>Entrar</Button>
          </form>
          <div className="flex items-center gap-3 text-sm text-muted" aria-hidden><span className="h-px flex-1 bg-[var(--color-line)]" />o<span className="h-px flex-1 bg-[var(--color-line)]" /></div>
          <Button variant="outline" size="lg" className="w-full" disabled={demo.isPending} onClick={() => demo.mutate()}>Entrar como demo</Button>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs text-ink-2">
          <span>Video: Boris Ivas, Pexels</span>
          <Button variant="ghost" onClick={toggle} aria-pressed={paused}>{paused ? <Play /> : <Pause />} {paused ? 'Reproducir video' : 'Pausar video'}</Button>
        </div>
      </div>
    </main>
  )
}
