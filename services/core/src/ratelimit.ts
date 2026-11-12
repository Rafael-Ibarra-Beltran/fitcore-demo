import { createMiddleware } from "hono/factory";

// shortcut: contador en memoria por IP, se pierde al reiniciar y no se comparte entre instancias; pasar a Redis/Cloudflare si hay más de una.
const hits = new Map<string, { n: number; reset: number }>();

export const rateLimit = (max: number, windowMs: number) =>
  createMiddleware(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0] ?? "local";
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return c.json({ error: "Demasiadas solicitudes" }, 429);
    return next();
  });
