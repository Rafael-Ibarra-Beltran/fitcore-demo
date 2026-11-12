import { APP_NAME, mxn } from "@fitcore/shared";
import { and, count, eq, gte, lt, max, sum } from "drizzle-orm";
import { db } from "./db";
import * as T from "./db/schema";
import { env } from "./env";
import { addDays, classesWithRoom, expiringMemberships, inactiveMembers, today } from "./queries";

export type Message = { to: string; text: string; template: { name: string; params: string[] } };
/** Envía un mensaje. Lanza si falla; devuelve "simulado" si no hay credenciales de WhatsApp. */
export type Notify = (m: Message) => Promise<"enviado" | "simulado">;
type Target = { key: string; recipient: string; to: string | null; text: string; template: Message["template"] };

const HOURS = 3_600_000;
const first = (name: string) => name.split(" ")[0];
const who = (name: string, phone: string) => `${name} · ${phone}`;
const when = (d: Date) => new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: env.gymTz }).format(d);
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const staff = (org: string, key: string, text: string, template: Message["template"]): Target =>
  ({ key, recipient: "Dueño", to: env.ownerPhone || null, text, template });

const JOBS: Record<string, (org: string) => Promise<Target[]>> = {
  // Membresías que vencen en 3 días o menos: si un día no corrió el cron, al siguiente aún se avisa.
  "recordatorio-vencimiento": async (org) =>
    (await expiringMemberships(org, 3)).map((m) => {
      const link = `${env.payUrlBase}/${m.id}`;
      return {
        key: `venc:${m.id}:${m.endsAt}`, recipient: who(m.name, m.phone), to: m.phone,
        text: `Hola ${first(m.name)}, tu membresía vence el ${m.endsAt}. Renueva aquí: ${link}`,
        template: { name: "fitcore_vencimiento", params: [first(m.name), m.endsAt, link] },
      };
    }),

  // Socios dados de alta ayer u hoy y leads de la landing de las últimas 24 h (los de WhatsApp ya hablan con el agente).
  bienvenida: async (org) => {
    const t0 = today();
    const [plans, classes, members, leads] = await Promise.all([
      db.select().from(T.plan).where(eq(T.plan.organizationId, org)).orderBy(T.plan.durationDays),
      classesWithRoom(org, 3),
      db.select().from(T.gymMember).where(and(eq(T.gymMember.organizationId, org), eq(T.gymMember.status, "activo"), gte(T.gymMember.joinedAt, addDays(t0, -1)))),
      db.select().from(T.lead).where(and(eq(T.lead.organizationId, org), eq(T.lead.source, "landing"), gte(T.lead.createdAt, new Date(Date.now() - 24 * HOURS)))),
    ]);
    const planTxt = plans.map((p) => `${p.name} ${mxn(p.priceCents)}`).join(", ") || "consulta en recepción";
    const classTxt = classes.map((c) => `${c.name} ${when(c.startsAt)}`).join(", ") || "consulta en recepción";
    const msg = (kind: string, id: string, name: string, phone: string): Target => ({
      key: `bienvenida:${kind}:${id}`, recipient: who(name, phone), to: phone,
      text: `Hola ${first(name)}, bienvenido a ${APP_NAME}. Planes: ${planTxt}. Próximas clases: ${classTxt}.`,
      template: { name: "fitcore_bienvenida", params: [first(name), planTxt, classTxt] },
    });
    return [...members.map((m) => msg("member", m.id, m.name, m.phone)), ...leads.map((l) => msg("lead", l.id, l.name, l.phone))];
  },

  // Socios sin asistencia en 30 días (los dados de alta hace menos de 30 días aún no cuentan), una vez al mes.
  reactivacion: async (org) => {
    const [members, [next]] = await Promise.all([inactiveMembers(org, 30), classesWithRoom(org, 1)]);
    const month = today().slice(0, 7);
    const cutoff = addDays(today(), -30);
    const classTxt = next ? `${next.name} ${when(next.startsAt)}` : "consulta los horarios en recepción";
    return members.filter((m) => m.joinedAt <= cutoff).map((m) => ({
      key: `react:${m.id}:${month}`, recipient: who(m.name, m.phone), to: m.phone,
      text: `Hola ${first(m.name)}, te extrañamos. Tu próxima clase con lugar: ${classTxt}.`,
      template: { name: "fitcore_reactivacion", params: [first(m.name), classTxt] },
    }));
  },

  // Aviso al personal por cada lead que sigue "nuevo" pasadas 48 h.
  "seguimiento-lead": async (org) =>
    (await db.select().from(T.lead).where(and(eq(T.lead.organizationId, org), eq(T.lead.status, "nuevo"), lt(T.lead.createdAt, new Date(Date.now() - 48 * HOURS)))))
      .map((l) => staff(org, `lead48:${l.id}`, `Lead sin seguimiento: ${l.name} (${l.phone}) lleva más de 48 horas como nuevo.`,
        { name: "fitcore_seguimiento_lead", params: [l.name, l.phone] })),

  // Resumen para el dueño. No incluye bajas: gym_member no guarda la fecha en que cambia su estado.
  "resumen-semanal": async (org) => {
    const t0 = today();
    const since = new Date(Date.now() - 7 * 24 * HOURS);
    const [[altas], [leads], [ingresos], [aforo], [vencen]] = await Promise.all([
      db.select({ n: count() }).from(T.gymMember).where(and(eq(T.gymMember.organizationId, org), gte(T.gymMember.joinedAt, addDays(t0, -7)))),
      db.select({ n: count() }).from(T.lead).where(and(eq(T.lead.organizationId, org), gte(T.lead.createdAt, since))),
      db.select({ s: sum(T.payment.amountCents) }).from(T.payment).where(and(eq(T.payment.organizationId, org), gte(T.payment.paidAt, since))),
      db.select({ m: max(T.occupancyEvent.people) }).from(T.occupancyEvent).where(and(eq(T.occupancyEvent.organizationId, org), gte(T.occupancyEvent.at, since))),
      expiringMemberships(org, 7).then((r) => [{ n: r.length }]),
    ]);
    const params = [String(altas.n), String(leads.n), mxn(Number(ingresos.s ?? 0)), aforo.m == null ? "sin datos" : String(aforo.m), String(vencen.n)];
    return [staff(org, `resumen:${isoWeek(new Date())}`,
      `Resumen semanal: ${params[0]} altas, ${params[1]} leads nuevos, ingresos ${params[2]}, aforo pico ${params[3]}, ${params[4]} membresías vencen en 7 días.`,
      { name: "fitcore_resumen_semanal", params })];
  },
};

export const JOB_NAMES = Object.keys(JOBS);

const STALE_MS = 10 * 60_000; // una reserva "pendiente" que quedó colgada (caída a medio envío) se reintenta

export async function runJob(name: string, org: string, opts: { notify: Notify; dryRun?: boolean }) {
  const build = JOBS[name];
  if (!build) throw Object.assign(new Error("Tarea desconocida"), { status: 404 });
  const targets = await build(org);
  const out = { job: name, dryRun: !!opts.dryRun, total: targets.length, sent: 0, simulated: 0, skipped: 0, errors: 0, preview: [] as { recipient: string; to: string | null; text: string }[] };
  const L = T.automationLog;
  for (const t of targets) {
    if (opts.dryRun) { out.preview.push({ recipient: t.recipient, to: t.to, text: t.text }); continue; }
    // Idempotencia: la clave (con la organización, porque es única global) se reserva antes de enviar.
    const key = `${org}:${t.key}`;
    let [row] = await db.insert(L).values({ organizationId: org, type: name, recipient: t.recipient, result: "pendiente", dedupeKey: key })
      .onConflictDoNothing().returning({ id: L.id });
    if (!row) {
      const [prev] = await db.select().from(L).where(eq(L.dedupeKey, key)).limit(1);
      // Se reintenta lo que falló, lo que no tenía destinatario (p. ej. aún sin OWNER_PHONE) y lo que quedó colgado.
      const retry = prev && (prev.result.startsWith("error") || prev.result === "sin destinatario" || (prev.result === "pendiente" && Date.now() - +prev.at > STALE_MS));
      if (!retry) { out.skipped++; continue; }
      row = { id: prev.id };
    }
    const set = (result: string) => db.update(L).set({ result, at: new Date() }).where(eq(L.id, row.id));
    if (!t.to) { await set("sin destinatario"); out.skipped++; continue; }
    try {
      const r = await opts.notify({ to: t.to, text: t.text, template: t.template });
      await set(r);
      out[r === "enviado" ? "sent" : "simulated"]++;
    } catch (e) {
      await set(`error: ${(e as Error).message}`.slice(0, 300));
      out.errors++;
    }
  }
  return out;
}
