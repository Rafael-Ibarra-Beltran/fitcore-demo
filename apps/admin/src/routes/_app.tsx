import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard, LogOut, Menu, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChatWidget } from '@fitcore/chat-widget'
import { APP_NAME } from '@fitcore/shared'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { RESOURCES } from '@/lib/resources'
import { useUi } from '@/lib/store'

type Me = { role: 'owner' | 'staff' | 'service'; orgId: string }
export const meQuery = { queryKey: ['me'], queryFn: () => api<Me>('/me') }

export const Route = createFileRoute('/_app')({
  // Sin sesión, al login.
  beforeLoad: async ({ context }) => {
    try { await context.queryClient.fetchQuery(meQuery) } catch { throw redirect({ to: '/login' }) }
  },
  component: Layout,
})

// El fondo de la selección lo pinta .nav-indicator (se desliza); el enlace solo cambia de color y peso.
const navItem = 'relative z-10 flex h-11 items-center gap-3 rounded-md px-3 text-sm text-ink-2 hover:text-ink [&.active]:font-semibold [&.active]:text-ink'

function Layout() {
  const { menuOpen, setMenuOpen } = useUi()
  const { data: me } = useQuery(meQuery)
  const out = useMutation({
    mutationFn: () => api('/auth/sign-out', { method: 'POST', body: {} }),
    onSuccess: () => { location.href = '/login' },
  })
  const path = useRouterState({ select: (s) => s.location.pathname }) // al cambiar de ruta se remonta y entra con fundido
  const items = Object.entries(RESOURCES).filter(([, r]) => !r.ownerOnly || me?.role === 'owner')
  const close = () => setMenuOpen(false)

  // Indicador de selección: se mueve con transform hacia el enlace activo.
  const nav = useRef<HTMLElement>(null)
  const [y, setY] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const place = () => {
    const el = nav.current?.querySelector<HTMLElement>('a.active')
    setY(el ? el.offsetTop : null)
  }
  useLayoutEffect(place, [path, items.length])
  useEffect(() => {
    const ro = new ResizeObserver(place)
    if (nav.current) ro.observe(nav.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { if (y !== null) requestAnimationFrame(() => setReady(true)) }, [y])

  return (
    <div className="min-h-screen min-[60rem]:grid min-[60rem]:grid-cols-[15rem_minmax(0,1fr)]">
      {menuOpen && <button aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-scrim min-[60rem]:hidden" onClick={close} />}
      <aside
        id="menu"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-sidebar transition-transform duration-200 min-[60rem]:sticky min-[60rem]:top-0 min-[60rem]:h-screen min-[60rem]:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link to="/" onClick={close} className="flex items-center gap-2.5 text-ink">
            <Logo className="h-7 w-auto" />
            <span className="font-display text-2xl font-bold uppercase leading-none">{APP_NAME}</span>
          </Link>
          <Button variant="ghost" size="icon" className="min-[60rem]:hidden" aria-label="Cerrar menú" onClick={close}><X /></Button>
        </div>
        <nav ref={nav} className="relative flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Principal">
          {y !== null && <span aria-hidden className="nav-indicator" data-ready={ready} style={{ transform: `translateY(${y}px)` }} />}
          <Link to="/" onClick={close} activeOptions={{ exact: true }} className={navItem}><LayoutDashboard className="size-4" /> Resumen</Link>
          {items.map(([slug, r]) => (
            <Link key={slug} to="/$resource" params={{ resource: slug }} onClick={close} className={navItem}><r.icon className="size-4" /> {r.title}</Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-paper px-4 min-[60rem]:px-8">
          <Button variant="ghost" size="icon" className="min-[60rem]:hidden" aria-label="Abrir menú" aria-controls="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu /></Button>
          <div className="ml-auto flex items-center gap-4 text-sm text-muted">
            {me && <span>{me.role === 'owner' ? 'Dueño' : 'Recepción'}</span>}
            <Button variant="outline" onClick={() => out.mutate()}><LogOut /> Salir</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] p-4 min-[60rem]:p-8"><div key={path} className="page-in"><Outlet /></div></main>
      </div>
      <ChatWidget
        coreUrl={((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')}
        aiUrl={((import.meta.env.VITE_AI_URL as string | undefined) ?? 'http://localhost:8000').replace(/\/$/, '')}
        whatsapp={import.meta.env.VITE_WHATSAPP as string | undefined}
        turnstileSiteKey={(import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? '1x00000000000000000000AA'}
      />
    </div>
  )
}
