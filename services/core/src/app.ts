import { zValidator } from "@hono/zod-validator";
import * as S from "@fitcore/shared";
import { and, count, eq, gte, isNull, lt, lte, or, sql as dsql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { auth } from "./auth";
import { callAi, notifyViaAi } from "./ai";
import { crud, registry } from "./crud";
import { db } from "./db";
import * as T from "./db/schema";
import { env } from "./env";
import { JOB_NAMES, runJob } from "./jobs";
import { mcpApp } from "./mcp";
import { addDays, businessStats, expiringMemberships, inactiveMembers, occupancyNow, today } from "./queries";
import { rateLimit } from "./ratelimit";
import { requireRole, tenant, type Env } from "./tenant";

const daysParam = (c: { req: { query: (k: string) => string | undefined } }, def: number) =>
  Math.min(Math.max(Number(c.req.query("days") ?? def) || def, 0), 3650);

export const app = new Hono();

app.use("*", cors({ origin: env.origins, credentials: true }));
app.onError((e, c) => {
  const status = (e as { status?: number }).status ?? 500;
  if (status >= 500) console.error(e);
  return c.json({ error: status >= 500 ? "Error interno" : e.message }, status as 400);
});
app.get("/health", (c) => c.json({ ok: true }));
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// ---------- Públicas ----------
const pub = new Hono();

pub.post("/leads", rateLimit(5, 60_000), zValidator("json", S.publicLeadInput), async (c) => {
  const { turnstileToken, ...lead } = c.req.valid("json");
  if (!env.skipTurnstile) {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: env.turnstileSecret, response: turnstileToken ?? "" }),
    }).catch(() => null);
    if (!r) return c.json({ error: "No se pudo verificar, intenta de nuevo" }, 503);
    if (!((await r.json().catch(() => ({}))) as { success?: boolean }).success) return c.json({ error: "Verificación fallida" }, 400);
  }
  const org = await db.query.organization.findFirst({ where: eq(T.organization.slug, env.serviceOrgSlug) });
  if (!org) return c.json({ error: "Organización no existe" }, 500);
  await db.insert(T.lead).values({ ...lead, source: "landing", organizationId: org.id });
  return c.json({ ok: true }, 201);
});

// Plan y horario públicos para la landing (solo lectura, sin datos de socios).
pub.get("/catalog", async (c) => {
  const org = await db.query.organization.findFirst({ where: eq(T.organization.slug, env.serviceOrgSlug) });
  if (!org) return c.json({ plans: [], classes: [] });
  const [plans, classes] = await Promise.all([
    db.select().from(T.plan).where(eq(T.plan.organizationId, org.id)),
    db.select({ id: T.gymClass.id, name: T.gymClass.name, instructor: T.gymClass.instructor, startsAt: T.gymClass.startsAt })
      .from(T.gymClass).where(and(eq(T.gymClass.organizationId, org.id), gte(T.gymClass.startsAt, new Date()))).orderBy(T.gymClass.startsAt).limit(12),
  ]);
  return c.json({ plans, classes });
});

// Entrar como demo: abre sesión con el usuario sembrado y reenvía la cookie.
pub.post("/demo/login", rateLimit(10, 60_000), async (c) => {
  const r = await auth.api.signInEmail({
    body: { email: env.demoEmail, password: env.demoPassword },
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  const cookie = r.headers.get("set-cookie");
  if (cookie) c.header("set-cookie", cookie);
  return c.json({ ok: true });
});
app.route("/api/public", pub);

// ---------- Privadas ----------
const api = new Hono<Env>();
api.use("*", tenant);

// Perezoso: marca vencidas las membresías pasadas de fecha al consultarlas (sin cron aún).
const expireMemberships = (org: string) =>
  db.update(T.membership).set({ status: "vencida" })
    .where(and(eq(T.membership.organizationId, org), eq(T.membership.status, "activa"), lt(T.membership.endsAt, today())));
api.use("/memberships", async (c, next) => { if (c.req.method === "GET") await expireMemberships(c.get("orgId")); await next(); });

api.get("/me", (c) => c.json({ role: c.get("role"), orgId: c.get("orgId") }));

api.get("/stats", async (c) => {
  const org = c.get("orgId");
  await expireMemberships(org);
  return c.json(await businessStats(org, c.get("role") !== "staff")); // los ingresos solo los ve el dueño
});

api.get("/memberships/expiring", async (c) => c.json(await expiringMemberships(c.get("orgId"), daysParam(c, 3))));

api.get("/attendance/inactive", async (c) => c.json(await inactiveMembers(c.get("orgId"), daysParam(c, 30))));

// Antes del CRUD de /occupancy: si no, "/now" se leería como un id.
api.get("/occupancy/now", async (c) => c.json(await occupancyNow(c.get("orgId"), env.occupancyMax)));

api.get("/occupancy/hourly", async (c) => {
  // Las fechas se guardan en UTC; el aforo se agrupa por hora local del gimnasio.
  const h = dsql`date_trunc('hour', ${T.occupancyEvent.at} at time zone 'UTC' at time zone ${dsql.raw(`'${env.gymTz.replace(/'/g, "''")}'`)})`;
  const rows = await db.select({ hour: dsql<string>`to_char(${h}, 'YYYY-MM-DD"T"HH24":00"')`, peak: dsql<number>`max(${T.occupancyEvent.people})::int` })
    .from(T.occupancyEvent)
    .where(and(eq(T.occupancyEvent.organizationId, c.get("orgId")), gte(T.occupancyEvent.at, new Date(Date.now() - daysParam(c, 1) * 864e5))))
    .groupBy(h).orderBy(h);
  return c.json(rows);
});

// El personal contesta una conversación de WhatsApp desde el panel.
api.post("/conversations/:id/reply", requireRole("owner", "staff"), zValidator("json", S.replyInput), async (c) => {
  const [conv] = await db.select({ id: T.conversation.id }).from(T.conversation)
    .where(and(eq(T.conversation.id, c.req.param("id")), eq(T.conversation.organizationId, c.get("orgId")))).limit(1);
  if (!conv) return c.json({ error: "No encontrado" }, 404);
  const { status, data } = await callAi("/send", { conversation_id: conv.id, text: c.req.valid("json").text });
  return status < 400 ? c.json(data) : c.json({ error: data.detail ?? "No se pudo enviar" }, (status === 401 ? 502 : status) as 409);
});

// Regenera los embeddings del RAG tras editar documentos.
api.post("/kb/reindex", requireRole("owner", "service"), async (c) => {
  const { status, data } = await callAi("/ingest");
  return status < 400 ? c.json(data) : c.json({ error: data.detail ?? "No se pudo reindexar" }, (status === 401 ? 502 : status) as 503);
});

// Automatizaciones: las dispara el cron externo (/internal, solo clave de servicio) o el dueño desde el panel.
const jobRoute = (c: { req: { param: (k: string) => string; query: (k: string) => string | undefined }; get: (k: "orgId") => string }) =>
  runJob(c.req.param("name"), c.get("orgId"), { notify: notifyViaAi, dryRun: c.req.query("dryRun") === "1" });
api.post("/automations/:name/run", requireRole("owner"), async (c) => c.json(await jobRoute(c)));
const internal = new Hono<Env>();
internal.use("*", tenant, requireRole("service"));
internal.post("/jobs/:name", async (c) => c.json(await jobRoute(c)));
app.route("/internal", internal);
app.route("/mcp", mcpApp);

const OWNER = ["owner", "service"] as const;
const mount = (path: string, o: Omit<Parameters<typeof crud>[0], "path">) => api.route(path, crud({ path: `/api${path}`, ...o }));

mount("/members", { table: T.gymMember, create: S.memberInput, order: ["joinedAt", "desc"] });
mount("/plans", { table: T.plan, create: S.planInput, order: ["durationDays", "asc"], writeRoles: [...OWNER] });
mount("/memberships", {
  table: T.membership, create: S.membershipInput, order: ["endsAt", "asc"], refs: { memberId: T.gymMember, planId: T.plan },
  patch: z.object({ status: z.enum(["activa", "vencida", "cancelada"]) }), // cambiar plan o fecha sin recalcular endsAt lo dejaría incoherente
  insert: async (tx, orgId, i) => {
    const [p] = await tx.select().from(T.plan).where(eq(T.plan.id, i.planId));
    const startsAt = i.startsAt ?? today();
    return (await tx.insert(T.membership).values({ ...i, startsAt, endsAt: addDays(startsAt, p.durationDays), organizationId: orgId }).returning())[0];
  },
});
mount("/payments", { table: T.payment, create: S.paymentInput, order: ["paidAt", "desc"], refs: { membershipId: T.membership }, writeRoles: [...OWNER], readRoles: [...OWNER] });
mount("/classes", { table: T.gymClass, create: S.classInput, order: ["startsAt", "asc"] });
mount("/bookings", {
  table: T.booking, create: S.bookingInput, refs: { classId: T.gymClass, memberId: T.gymMember },
  patch: z.object({ status: z.enum(["cancelada", "asistio"]) }), // reactivar saltaría el cupo
  insert: async (tx, orgId, i) => {
    // Bloquea la clase para que dos reservas simultáneas no pasen el cupo.
    const [cls] = await tx.select().from(T.gymClass).where(eq(T.gymClass.id, i.classId)).for("update");
    const active = await tx.select({ memberId: T.booking.memberId }).from(T.booking)
      .where(and(eq(T.booking.classId, i.classId), eq(T.booking.status, "reservada")));
    if (active.length >= cls.capacity) throw Object.assign(new Error("La clase está llena"), { status: 409 });
    if (active.some((b) => b.memberId === i.memberId)) throw Object.assign(new Error("Ya tiene reserva"), { status: 409 });
    return (await tx.insert(T.booking).values({ classId: i.classId, memberId: i.memberId, organizationId: orgId }).returning())[0];
  },
});
mount("/attendance", { table: T.attendance, create: S.attendanceInput, order: ["checkedInAt", "desc"], refs: { memberId: T.gymMember } });
mount("/leads", { table: T.lead, create: S.leadInput });
mount("/occupancy", { table: T.occupancyEvent, create: S.occupancyInput, order: ["at", "desc"], writeRoles: ["service"], noDelete: true });
mount("/conversations", { table: T.conversation, create: S.conversationInput, refs: { memberId: T.gymMember, leadId: T.lead } });
mount("/kb", { table: T.kbDocument, create: S.kbDocumentInput, order: ["createdAt", "desc"], writeRoles: [...OWNER] });
mount("/automation-log", { table: T.automationLog, create: z.object({}), order: ["at", "desc"], readRoles: ["owner"], writeRoles: [], noDelete: true }); // solo lectura: lo escriben las tareas
mount("/messages", { table: T.message, create: S.messageInput, refs: { conversationId: T.conversation } });

app.route("/api", api);

// ---------- OpenAPI ----------
// Rutas que no pasan por crud(): se declaran aquí para que el contrato esté completo.
registry.push(
  { path: "/api/public/leads", method: "post", schema: S.publicLeadInput },
  ...["/api/public/catalog", "/api/me", "/api/stats", "/api/memberships/expiring", "/api/attendance/inactive", "/api/occupancy/hourly", "/api/occupancy/now"]
    .map((path) => ({ path, method: "get" })),
  { path: "/api/public/demo/login", method: "post" },
  { path: "/api/conversations/{id}/reply", method: "post", schema: S.replyInput },
  { path: "/api/kb/reindex", method: "post" },
  { path: "/api/automations/{name}/run", method: "post" },
  ...JOB_NAMES.map((n) => ({ path: `/internal/jobs/${n}`, method: "post" })),
);
app.get("/openapi.json", (c) => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry)
    (paths[r.path] ??= {})[r.method] = {
      ...(r.schema && { requestBody: { content: { "application/json": { schema: z.toJSONSchema(r.schema, { io: "input", unrepresentable: "any" }) } } } }),
      responses: { 200: { description: "OK" } },
    };
  return c.json({ openapi: "3.1.0", info: { title: `${S.APP_NAME} API`, version: "0.1.0" }, paths });
});
