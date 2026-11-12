// Cron externo: cada disparo llama a una tarea del núcleo (POST /internal/jobs/:nombre) con la clave de servicio.
// Las tareas son idempotentes, así que un reintento o un doble disparo no duplica mensajes.
interface Env { CORE_URL: string; SERVICE_KEY: string }

// Debe coincidir con [triggers].crons de wrangler.toml (en UTC; México no tiene horario de verano desde 2022, UTC-6).
const JOBS: Record<string, string> = {
  "0 16 * * *": "recordatorio-vencimiento", // 10:00 hora del gimnasio
  "*/15 * * * *": "bienvenida",
  "0 17 * * *": "reactivacion", // 11:00
  "0 15 * * *": "seguimiento-lead", // 09:00
  "0 14 * * 1": "resumen-semanal", // lunes 08:00
};

async function call(job: string, env: Env): Promise<void> {
  // El núcleo en Render se duerme: la primera llamada lo despierta (hasta ~1 min), por eso un reintento a los 30 s.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${env.CORE_URL}/internal/jobs/${job}`, { method: "POST", headers: { "x-service-key": env.SERVICE_KEY } });
      if (r.ok) return console.log(job, await r.text());
      console.error(job, "respondió", r.status, await r.text());
    } catch (e) {
      console.error(job, "falló la llamada", e);
    }
    if (attempt < 2) await new Promise((res) => setTimeout(res, 30_000));
  }
  throw new Error(`La tarea ${job} no se pudo ejecutar`);
}

export default {
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const job = JOBS[event.cron];
    if (job) ctx.waitUntil(call(job, env));
    else console.error("Cron sin tarea asignada:", event.cron);
  },
  fetch: () => new Response("fitcore automations", { status: 200 }),
};
