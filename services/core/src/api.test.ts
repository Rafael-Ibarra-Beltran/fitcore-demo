// Requiere Postgres levantado y sembrado (bun run db:up && db:migrate && db:seed).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, count, eq } from "drizzle-orm";
import { app } from "./app";
import { db, sql } from "./db";
import { env } from "./env";
import { runJob, type Message, type Notify } from "./jobs";
import { addDays, occupancyNow, searchMembers, today } from "./queries";
import * as T from "./db/schema";

const svc = { "x-service-key": env.serviceKey };
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.request(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

async function login(email: string) {
  const r = await call("/api/auth/sign-in/email", json({ email, password: env.demoPassword }));
  expect(r.status).toBe(200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

let otherOrg: string;
beforeAll(async () => {
  [{ id: otherOrg }] = await db.insert(T.organization).values({ id: crypto.randomUUID(), name: "Otro", slug: "otro-test", createdAt: new Date() }).returning();
});
afterAll(async () => {
  await db.delete(T.organization).where(eq(T.organization.slug, "otro-test"));
  await sql.end();
});

test("sin sesión ni clave: 401", async () => {
  expect((await call("/api/members")).status).toBe(401);
  expect((await call("/api/members", { headers: { "x-service-key": "mala" } })).status).toBe(401);
});

test("staff no ve pagos; owner sí", async () => {
  const staff = await login("staff@fitcore.test");
  expect((await call("/api/payments", { headers: staff })).status).toBe(403);
  const owner = await login(env.demoEmail);
  expect((await call("/api/payments", { headers: owner })).status).toBe(200);
  const stats = await (await call("/api/stats", { headers: staff })).json();
  expect(stats.revenueCents).toBeNull();
});

test("aislamiento: no se puede referenciar un plan de otra organización", async () => {
  const [foreign] = await db.insert(T.plan).values({ organizationId: otherOrg, name: "Ajeno", priceCents: 100, durationDays: 30 }).returning();
  const [m] = await (await call("/api/members?limit=1", { headers: svc })).json();
  const r = await call("/api/memberships", { ...json({ memberId: m.id, planId: foreign.id }), headers: { ...svc, "content-type": "application/json" } });
  expect(r.status).toBe(400);
  expect((await call(`/api/plans/${foreign.id}`, { headers: svc })).status).toBe(404);
});

test("clase llena rechaza la reserva (409)", async () => {
  const classes: { id: string; capacity: number }[] = await (await call("/api/classes", { headers: svc })).json();
  const full = classes.find((c) => c.capacity === 2)!;
  const members = await (await call("/api/members?limit=40", { headers: svc })).json();
  const r = await call("/api/bookings", { ...json({ classId: full.id, memberId: members[0].id }), headers: { ...svc, "content-type": "application/json" } });
  expect(r.status).toBe(409);
});

test("vencimientos próximos y socios inactivos", async () => {
  const exp = await (await call("/api/memberships/expiring?days=7", { headers: svc })).json();
  expect(exp.length).toBeGreaterThan(0);
  const inactive = await (await call("/api/attendance/inactive?days=30", { headers: svc })).json();
  expect(inactive.length).toBeGreaterThan(0);
});

test("membresías: PATCH ignora plan/fecha y las pasadas de fecha se marcan vencidas", async () => {
  const [m] = await (await call("/api/members?limit=1", { headers: svc })).json();
  const [plan] = await (await call("/api/plans?limit=1", { headers: svc })).json();
  const mk = await call("/api/memberships", { ...json({ memberId: m.id, planId: plan.id, startsAt: "2020-01-01" }), headers: { ...svc, "content-type": "application/json" } });
  const created = await mk.json();
  const patch = await call(`/api/memberships/${created.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: "2030-01-01" }), headers: svc });
  expect(patch.status).toBe(400);
  const list: { id: string; status: string }[] = await (await call("/api/memberships?limit=500", { headers: svc })).json();
  expect(list.find((x) => x.id === created.id)?.status).toBe("vencida");
  await call(`/api/memberships/${created.id}`, { method: "DELETE", headers: svc });
});

test("openapi incluye rutas no-CRUD", async () => {
  const { paths } = await (await call("/openapi.json")).json();
  expect(paths["/api/stats"]).toBeDefined();
  expect(paths["/api/public/leads"].post).toBeDefined();
});

test("base de conocimiento: solo el dueño escribe; recepción solo lee", async () => {
  const staff = await login("staff@fitcore.test");
  expect((await call("/api/kb", { headers: staff })).status).toBe(200);
  expect((await call("/api/kb", { ...json({ title: "X", content: "Y" }), headers: { ...staff, "content-type": "application/json" } })).status).toBe(403);
  const mk = await call("/api/kb", { ...json({ title: "Prueba KB", content: "Contenido" }), headers: { ...svc, "content-type": "application/json" } });
  expect(mk.status).toBe(201);
  const doc = await mk.json();
  expect((await call(`/api/kb/${doc.id}`, { method: "DELETE", headers: svc })).status).toBe(200);
});

test("responder y reindexar: roles y conversación ajena", async () => {
  const body = json({ text: "hola" });
  expect((await call("/api/conversations/x/reply", body)).status).toBe(401);
  expect((await call("/api/conversations/x/reply", { ...body, headers: { ...svc, "content-type": "application/json" } })).status).toBe(403); // el servicio no escribe como personal
  const staff = await login("staff@fitcore.test");
  expect((await call("/api/conversations/no-existe/reply", { ...body, headers: { ...staff, "content-type": "application/json" } })).status).toBe(404);
  expect((await call("/api/kb/reindex", { method: "POST", headers: staff })).status).toBe(403);
});

test("lead público: 201 y limita a 5 por minuto", async () => {
  const lead = { name: "Prueba Test", phone: "5512345678" };
  expect((await call("/api/public/leads", json(lead))).status).toBe(201);
  for (let i = 0; i < 4; i++) await call("/api/public/leads", json(lead));
  expect((await call("/api/public/leads", json(lead))).status).toBe(429);
  await db.delete(T.lead).where(eq(T.lead.name, "Prueba Test"));
});

// ---------- Automatizaciones: se prueban en la organización de prueba para no ensuciar el log de la demo ----------
const calls: Message[] = [];
const ok: Notify = async (m) => (calls.push(m), "simulado");
const logRows = async (type: string) =>
  (await db.select({ n: count() }).from(T.automationLog).where(and(eq(T.automationLog.organizationId, otherOrg), eq(T.automationLog.type, type))))[0].n;
const run = (name: string, o: { notify?: Notify; dryRun?: boolean } = {}) => runJob(name, otherOrg, { notify: o.notify ?? ok, dryRun: o.dryRun });

test("automatizaciones: fixtures", async () => {
  const org = otherOrg;
  const [plan] = await db.insert(T.plan).values({ organizationId: org, name: "Mensual T", priceCents: 59900, durationDays: 30 }).returning();
  const [ana] = await db.insert(T.gymMember).values({ organizationId: org, name: "Ana Prueba", phone: "+525500000001", joinedAt: today() }).returning();
  await db.insert(T.gymMember).values({ organizationId: org, name: "Beto Inactivo", phone: "+525500000002", joinedAt: addDays(today(), -60) });
  await db.insert(T.membership).values({ organizationId: org, memberId: ana.id, planId: plan.id, startsAt: addDays(today(), -28), endsAt: addDays(today(), 2), status: "activa" });
  await db.insert(T.lead).values({ organizationId: org, name: "Lucia Lead", phone: "+525500000003", source: "landing", status: "nuevo", createdAt: new Date(Date.now() - 3 * 864e5) });
});

test("recordatorio: dryRun no registra; envía una vez y no repite", async () => {
  const dry = await run("recordatorio-vencimiento", { dryRun: true });
  expect(dry.preview.length).toBe(1);
  expect(calls.length).toBe(0);
  expect(await logRows("recordatorio-vencimiento")).toBe(0);
  const r1 = await run("recordatorio-vencimiento");
  expect(r1).toMatchObject({ total: 1, simulated: 1, skipped: 0, errors: 0 });
  expect(calls[0].to).toBe("+525500000001");
  expect(calls[0].text).toContain("Ana");
  expect(calls[0].text).toContain("pago.ejemplo.test");
  expect(calls[0].template.name).toBe("fitcore_vencimiento");
  const r2 = await run("recordatorio-vencimiento");
  expect(r2).toMatchObject({ simulated: 0, skipped: 1 });
  expect(calls.length).toBe(1);
});

test("un error de envío se registra y se reintenta en la siguiente corrida", async () => {
  const boom: Notify = async () => { throw new Error("WhatsApp 400"); };
  expect(await run("bienvenida", { notify: boom })).toMatchObject({ total: 1, errors: 1 }); // solo Ana: el lead tiene 3 días
  const [row] = await db.select().from(T.automationLog).where(and(eq(T.automationLog.organizationId, otherOrg), eq(T.automationLog.type, "bienvenida")));
  expect(row.result).toStartWith("error: WhatsApp 400");
  expect(await run("bienvenida")).toMatchObject({ simulated: 1, errors: 0 });
  expect(await logRows("bienvenida")).toBe(1); // la misma fila, no una nueva
  expect(await run("bienvenida")).toMatchObject({ skipped: 1 });
});

test("reactivación: solo socios con más de 30 días de alta", async () => {
  const { preview } = await run("reactivacion", { dryRun: true });
  expect(preview.map((p) => p.recipient).join()).toContain("Beto");
  expect(preview.map((p) => p.recipient).join()).not.toContain("Ana");
});

test("seguimiento de lead y resumen: sin OWNER_PHONE no se envía, y al configurarlo se reintenta", async () => {
  const before = calls.length;
  env.ownerPhone = "";
  expect(await run("seguimiento-lead")).toMatchObject({ total: 1, skipped: 1 });
  expect(calls.length).toBe(before);
  env.ownerPhone = "+520000000000";
  expect(await run("seguimiento-lead")).toMatchObject({ simulated: 1 });
  expect(calls.at(-1)!.to).toBe("+520000000000");
  expect(calls.at(-1)!.text).toContain("Lucia Lead");
  const res = await run("resumen-semanal");
  expect(res).toMatchObject({ total: 1, simulated: 1 });
  expect(calls.at(-1)!.text).toContain("altas");
  expect(await run("resumen-semanal")).toMatchObject({ skipped: 1 }); // una vez por semana
  env.ownerPhone = "";
});

test("las claves de idempotencia de dos organizaciones no chocan", async () => {
  const [demoOrg] = await db.select().from(T.organization).where(eq(T.organization.slug, env.serviceOrgSlug));
  const a = await runJob("recordatorio-vencimiento", demoOrg.id, { notify: ok, dryRun: true });
  expect(a.dryRun).toBe(true);
  // La clave lleva el id de la organización: la misma membresía-clave en otra organización es otra fila.
  const keys = (await db.select({ k: T.automationLog.dedupeKey }).from(T.automationLog).where(eq(T.automationLog.organizationId, otherOrg))).map((r) => r.k);
  expect(keys.every((k) => k!.startsWith(otherOrg + ":"))).toBe(true);
});

test("/internal solo acepta la clave de servicio; tareas desconocidas dan 404", async () => {
  const hdr = { "content-type": "application/json" };
  expect((await call("/internal/jobs/bienvenida", { method: "POST" })).status).toBe(401);
  const staff = await login("staff@fitcore.test");
  expect((await call("/internal/jobs/bienvenida", { method: "POST", headers: { ...staff, ...hdr } })).status).toBe(403);
  const owner = await login(env.demoEmail);
  expect((await call("/internal/jobs/bienvenida", { method: "POST", headers: { ...owner, ...hdr } })).status).toBe(403);
  expect((await call("/internal/jobs/no-existe", { method: "POST", headers: svc })).status).toBe(404);
  const dry = await (await call("/internal/jobs/recordatorio-vencimiento?dryRun=1", { method: "POST", headers: svc })).json();
  expect(dry.dryRun).toBe(true);
  // El panel: el dueño ejecuta, recepción no.
  expect((await call("/api/automations/bienvenida/run", { method: "POST", headers: { ...staff, ...hdr } })).status).toBe(403);
  expect((await call("/api/automations/no-existe/run", { method: "POST", headers: { ...owner, ...hdr } })).status).toBe(404);
  // El log es solo lectura para el dueño y no se escribe por API.
  expect((await call("/api/automation-log", { headers: owner })).status).toBe(200);
  expect((await call("/api/automation-log", { headers: staff })).status).toBe(403);
  expect((await call("/api/automation-log", { method: "POST", body: "{}", headers: { ...owner, ...hdr } })).status).toBe(403);
});

// ---------- Servidor MCP ----------
const MCP_KEY = "k".repeat(32);
const rpc = (method: string, params?: unknown, headers: Record<string, string> = { authorization: `Bearer ${MCP_KEY}` }) =>
  app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
// La respuesta llega como evento SSE ("data: {json}") o como JSON plano.
const rpcBody = async (r: Response) => {
  const t = await r.text();
  return JSON.parse(t.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? t);
};

test("MCP: apagado sin clave; con clave exige Bearer o X-API-Key y valida Origin", async () => {
  env.mcpKey = "";
  expect((await rpc("tools/list")).status).toBe(404); // apagado por defecto
  env.mcpKey = MCP_KEY;
  expect((await rpc("tools/list", undefined, {})).status).toBe(401);
  expect((await rpc("tools/list", undefined, { authorization: "Bearer mala" })).status).toBe(401);
  expect((await rpc("tools/list", undefined, { "x-api-key": MCP_KEY })).status).toBe(200);
  expect((await rpc("tools/list", undefined, { authorization: `Bearer ${MCP_KEY}`, origin: "https://evil.example" })).status).toBe(403);
  expect((await rpc("tools/list", undefined, { authorization: `Bearer ${MCP_KEY}`, origin: "http://localhost:5173" })).status).toBe(200);
  expect((await app.request("/mcp", { headers: { authorization: `Bearer ${MCP_KEY}` } })).status).toBe(405);
  expect((await call("/api/members", { headers: { authorization: `Bearer ${MCP_KEY}` } })).status).toBe(401); // la clave del MCP no abre la API
});

test("MCP: siete herramientas, todas de solo lectura y sin parámetro de organización", async () => {
  const { result } = await rpcBody(await rpc("tools/list"));
  expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
    ["aforo_actual", "buscar_socio", "clases_proximas", "leads_nuevos", "membresias_por_vencer", "resumen_negocio", "socios_inactivos"]);
  for (const t of result.tools) {
    expect(t.annotations.readOnlyHint).toBe(true);
    expect(Object.keys(t.inputSchema.properties ?? {}).join()).not.toMatch(/org/i);
  }
});

test("MCP: las herramientas devuelven datos del seed y rechazan argumentos inválidos", async () => {
  const inactive = await rpcBody(await rpc("tools/call", { name: "socios_inactivos", arguments: { dias: 30 } }));
  expect(JSON.parse(inactive.result.content[0].text).length).toBeGreaterThan(0);
  const stats = await rpcBody(await rpc("tools/call", { name: "resumen_negocio", arguments: { organizationId: "otra" } })); // se ignora
  expect(JSON.parse(stats.result.content[0].text).members).toBeGreaterThan(0);
  const bad = await rpcBody(await rpc("tools/call", { name: "socios_inactivos", arguments: { dias: -5 } }));
  expect(bad.result.isError).toBe(true);
  env.mcpKey = "";
});

test("buscar_socio solo ve la organización indicada", async () => {
  const [demo] = await db.select().from(T.organization).where(eq(T.organization.slug, env.serviceOrgSlug));
  expect((await searchMembers(otherOrg, "Ana")).map((m) => m.name)).toEqual(["Ana Prueba"]);
  expect(await searchMembers(demo.id, "Ana Prueba")).toEqual([]);
  expect(await searchMembers(otherOrg, "Miguel")).toEqual([]);
  expect((await searchMembers(otherOrg, "Ana"))[0].membership?.status).toBe("activa");
  expect(await searchMembers(otherOrg, "%")).toEqual([]); // los comodines de LIKE se escapan
});

// ---------- Aforo ----------
test("GET /api/occupancy?limit=1 devuelve la lectura más reciente, no una cualquiera", async () => {
  const [demo] = await db.select().from(T.organization).where(eq(T.organization.slug, env.serviceOrgSlug));
  const mk = (people: number, at: Date) => ({ organizationId: demo.id, camera: "test-orden", people, at });
  await db.insert(T.occupancyEvent).values([mk(1, new Date(Date.now() - 5 * 864e5)), mk(99, new Date(Date.now() + 2 * 864e5)), mk(2, new Date(Date.now() - 864e5))]);
  try {
    const [latest] = await (await call("/api/occupancy?limit=1", { headers: svc })).json();
    expect(latest.people).toBe(99);
  } finally {
    await db.delete(T.occupancyEvent).where(eq(T.occupancyEvent.camera, "test-orden"));
  }
});

test("occupancyNow: sin lecturas es null; una lectura vieja no alerta; la última manda", async () => {
  const ev = (people: number, ageMs: number) =>
    db.insert(T.occupancyEvent).values({ organizationId: otherOrg, camera: "c1", people, at: new Date(Date.now() - ageMs) });
  expect(await occupancyNow(otherOrg, 40)).toBeNull();
  await ev(50, 30 * 60_000); // hace 30 min: ya no describe "ahora"
  expect(await occupancyNow(otherOrg, 40)).toMatchObject({ people: 50, max: 40, fresh: false, over: false });
  await ev(50, 1000);
  expect(await occupancyNow(otherOrg, 40)).toMatchObject({ people: 50, fresh: true, over: true });
  expect(await occupancyNow(otherOrg, 50)).toMatchObject({ over: false }); // justo en el máximo no es "sobre"
  await ev(10, 0);
  expect(await occupancyNow(otherOrg, 40)).toMatchObject({ people: 10, over: false });
});

test("/api/occupancy/now: lo lee cualquier rol, pero solo el servicio escribe lecturas", async () => {
  const staff = await login("staff@fitcore.test");
  const r = await call("/api/occupancy/now", { headers: staff });
  expect(r.status).toBe(200);
  const body = await r.json();
  if (body) expect(body).toMatchObject({ max: env.occupancyMax });
  expect((await call("/api/occupancy", { ...json({ camera: "x", people: 1 }), headers: { ...staff, "content-type": "application/json" } })).status).toBe(403);
  expect((await call("/api/occupancy/now")).status).toBe(401);
});
