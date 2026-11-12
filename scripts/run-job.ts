// Dispara una tarea de automatización en local, igual que lo hará el cron:
//   bun run jobs:run recordatorio-vencimiento [--dry]
const [name, flag] = process.argv.slice(2);
if (!name) {
  console.error("Uso: bun run jobs:run <tarea> [--dry]\nTareas: recordatorio-vencimiento, bienvenida, reactivacion, seguimiento-lead, resumen-semanal");
  process.exit(1);
}
const base = process.env.CORE_URL ?? "http://localhost:3000";
const r = await fetch(`${base}/internal/jobs/${name}${flag === "--dry" ? "?dryRun=1" : ""}`, {
  method: "POST",
  headers: { "x-service-key": process.env.SERVICE_KEY ?? "dev-service-key" },
});
console.log(r.status, JSON.stringify(await r.json(), null, 2));
process.exit(r.ok ? 0 : 1);
