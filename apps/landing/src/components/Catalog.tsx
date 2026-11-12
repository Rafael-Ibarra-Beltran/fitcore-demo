import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { mxn } from '@fitcore/shared'

gsap.registerPlugin(ScrollTrigger)

type Plan = { id: string; name: string; priceCents: number; durationDays: number }
type Cls = { id: string; name: string; instructor: string; startsAt: string }
type Catalog = { plans: Plan[]; classes: Cls[] }
const API = (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000')
const TZ = 'America/Mexico_City'

let cache: Promise<Catalog> | undefined
const loadCatalog = () => (cache ??= fetch(`${API}/api/public/catalog`).then((r) => { if (!r.ok) throw new Error(); return r.json() }).catch((e) => { cache = undefined; throw e }))
function useCatalog() {
  const [data, setData] = useState<Catalog | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { loadCatalog().then((d) => { setData(d); requestAnimationFrame(() => ScrollTrigger.refresh()) }).catch(() => setFailed(true)) }, [])
  return { data, failed }
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const hourOf = (v: string) => Number(new Intl.DateTimeFormat('es-MX', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date(v)))
const when = (v: string) => new Date(v).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })

// Franjas del día: la hora tiñe la página (--hue) y elige el video.
const BANDS = [
  { key: 'dawn', time: '6:00', title: 'Amanecer', text: 'Abrimos de lunes a viernes a las 6:00.', hue: 255, test: (h: number) => h < 11 },
  { key: 'midday', time: '13:00', title: 'Mediodía', text: 'Entrenadores que te conocen por nombre.', hue: 215, test: (h: number) => h >= 11 && h < 17 },
  { key: 'night', time: '20:00', title: 'Noche', text: 'Cerramos a las 22:00.', hue: 55, test: (h: number) => h >= 17 },
]

export function Plans() {
  const { data, failed } = useCatalog()
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!data || reduced() || !root.current) return
    const ctx = gsap.context(() => {
      gsap.from('.plan', { y: 48, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.plans__grid', start: 'top 80%', once: true } })
    }, root)
    return () => ctx.revert()
  }, [data])
  const plans = data ? [...data.plans].sort((a, b) => a.durationDays - b.durationDays) : []
  return (
    <section id="planes" className="plans" ref={root}>
      <div className="container">
        <h2 className="section-title">Planes</h2>
        {failed && <p>No pudimos cargar los planes. Escríbenos por WhatsApp.</p>}
        {!data && !failed && <p>Cargando planes…</p>}
        <div className="plans__grid">
          {plans.map((p, i) => (
            <div key={p.id} className={`plan${i === 1 ? ' plan--featured' : ''}`}>
              <h3>{p.name}</h3>
              <div className="plan__price num">{mxn(p.priceCents)}</div>
              <p>{p.durationDays} días de acceso</p>
              <a href="#contacto" className="btn">Quiero este plan</a>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Schedule() {
  const { data, failed } = useCatalog()
  const root = useRef<HTMLElement>(null)
  const clock = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    const motion = !reduced()
    const scenes = gsap.utils.toArray<HTMLElement>('.scene', el)
    const videos = el.querySelectorAll('video')
    if (!motion) videos.forEach((v) => { v.pause(); v.removeAttribute('autoplay') })
    const mm = gsap.matchMedia()
    mm.add('(min-width: 56rem)', () => {
      if (!motion) return
      el.classList.add('is-pinned')
      const hue = { v: BANDS[0].hue }
      const paint = () => document.documentElement.style.setProperty('--hue', String(Math.round(hue.v)))
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: el.querySelector('.day__stage'), start: 'top top', end: '+=260%', pin: true, scrub: 0.6,
          onUpdate: (s) => { if (clock.current) { const h = 6 + 16 * s.progress; clock.current.textContent = `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}` } },
        },
      })
      scenes.forEach((s, i) => {
        if (i === 0) return
        const at = i * 1
        tl.to(scenes[i - 1], { opacity: 0, y: -40, duration: 0.3 }, at - 0.15)
          .set(scenes[i - 1], { visibility: 'hidden' }, at + 0.15)
          .set(s, { visibility: 'visible' }, at - 0.15)
          .fromTo(s, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.3 }, at - 0.15)
          .to(hue, { v: BANDS[i].hue, duration: 0.4, onUpdate: paint }, at - 0.2)
      })
      tl.to({}, { duration: 0.2 }) // pausa final sobre la última escena
      return () => { el.classList.remove('is-pinned'); document.documentElement.style.setProperty('--hue', '255'); scenes.forEach((s) => gsap.set(s, { clearProps: 'all' })) }
    })
    mm.add('(max-width: 55.999rem)', () => {
      if (!motion) return
      // Sin pin: el tono avanza con el scroll de todo el bloque (no con un tween de tiempo fijo), así no se siente como un golpe.
      const hue = { v: BANDS[0].hue }
      const paint = () => document.documentElement.style.setProperty('--hue', String(Math.round(hue.v)))
      const tl = gsap.timeline({
        defaults: { ease: 'none', duration: 1, onUpdate: paint },
        scrollTrigger: { trigger: el.querySelector('.day__stage'), start: 'top 70%', end: 'bottom 30%', scrub: 1.2 },
      })
      tl.to(hue, { v: BANDS[1].hue }).to(hue, { v: BANDS[2].hue })
      return () => { tl.scrollTrigger?.kill(); tl.kill(); document.documentElement.style.setProperty('--hue', String(BANDS[0].hue)) }
    })
    return () => mm.revert()
  }, [data])

  const byBand = BANDS.map((b) => ({ ...b, classes: (data?.classes ?? []).filter((c) => b.test(hourOf(c.startsAt))).slice(0, 4) }))
  return (
    <section id="horarios" className="day" ref={root}>
      <div className="container">
        <div className="day__stage">
          <div className="day__head"><h2 className="section-title">Próximas clases</h2>{failed && <p>Pronto publicaremos las próximas clases.</p>}</div>
          <div className="day__clock num" aria-hidden="true" ref={clock}>6:00</div>
          {byBand.map((b) => (
            <article className="scene" key={b.key}>
              <div className="scene__text">
                <div className="scene__time num">{b.time}</div>
                <h3>{b.title}</h3>
                <p className="lead">{b.text}</p>
                {b.classes.length > 0 && (
                  <ul className="classes">
                    {b.classes.map((c) => <li key={c.id}><strong>{c.name}</strong><span>{when(c.startsAt)} con {c.instructor}</span></li>)}
                  </ul>
                )}
              </div>
              <div className="scene__media">
                <video src={`/media/${b.key}.mp4`} poster={`/media/${b.key}.webp`} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
