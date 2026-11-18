type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void };
// Cast en lugar de `declare global`: así ninguna app choca con otra declaración de window.turnstile.
const current = () => (window as unknown as { turnstile?: Turnstile }).turnstile;

let loading: Promise<Turnstile> | null = null;
/** Carga el script de Cloudflare una sola vez, sin importar cuántos componentes lo pidan. */
export function loadTurnstile(): Promise<Turnstile> {
  return (loading ??= new Promise<Turnstile>((ok, fail) => {
    const ready = current();
    if (ready) return ok(ready);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.onload = () => ok(current()!);
    s.onerror = () => { loading = null; fail(new Error("No se pudo cargar la verificación.")); };
    document.head.appendChild(s);
  }));
}

/** Turnstile invisible. Cada token vale una sola vez, así que se renueva después de usarlo. */
export function tokenGetter(sitekey: string): () => Promise<string> {
  type W = { id: string; token: string; waiters: ((t: string) => void)[] };
  let w: W | null = null;
  return async () => {
    const t = await loadTurnstile();
    if (!w) {
      const box = document.createElement("div");
      document.body.appendChild(box);
      const me: W = (w = { id: "", token: "", waiters: [] });
      me.id = t.render(box, { sitekey, theme: "dark", appearance: "interaction-only", callback: (tok: string) => { me.token = tok; me.waiters.splice(0).forEach((f) => f(tok)); } });
    }
    const me: W = w;
    const token = me.token || await Promise.race([
      new Promise<string>((r) => me.waiters.push(r)),
      new Promise<string>((_, no) => setTimeout(() => no(new Error("La verificación tardó demasiado.")), 15_000)),
    ]);
    me.token = "";
    t.reset(me.id);
    return token;
  };
}
