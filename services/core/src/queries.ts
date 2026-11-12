import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql as dsql, sum } from "drizzle-orm";
import { db } from "./db";
import * as T from "./db/schema";

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

/** Membresías activas que vencen entre hoy y dentro de `days` días. */
export const expiringMemberships = (org: string, days: number) => {
  const t0 = today();
  return db.select({
    id: T.membership.id, memberId: T.membership.memberId, endsAt: T.membership.endsAt,
    name: T.gymMember.name, phone: T.gymMember.phone,
  }).from(T.membership).innerJoin(T.gymMember, eq(T.gymMember.id, T.membership.memberId))
    .where(and(eq(T.membership.organizationId, org), eq(T.membership.status, "activa"),
      gte(T.membership.endsAt, t0), lte(T.membership.endsAt, addDays(t0, days)))).orderBy(T.membership.endsAt);
};

/** Socios activos sin asistencia en los últimos `days` días (o que nunca han asistido). */
export const inactiveMembers = (org: string, days: number) => {
  const cutoff = new Date(Date.now() - days * 864e5);
  const last = dsql<Date | null>`max(${T.attendance.checkedInAt})`;
  return db.select({ id: T.gymMember.id, name: T.gymMember.name, phone: T.gymMember.phone, joinedAt: T.gymMember.joinedAt, lastVisit: last })
    .from(T.gymMember)
    .leftJoin(T.attendance, eq(T.attendance.memberId, T.gymMember.id))
    .where(and(eq(T.gymMember.organizationId, org), eq(T.gymMember.status, "activo")))
    .groupBy(T.gymMember.id)
    .having(or(isNull(last), dsql`${last} < ${cutoff.toISOString()}::timestamp`));
};

/** Cifras del tablero. Los ingresos solo se calculan para quien puede verlos. */
export async function businessStats(org: string, withRevenue: boolean) {
  const t0 = today();
  const [{ n: members }] = await db.select({ n: count() }).from(T.gymMember).where(and(eq(T.gymMember.organizationId, org), eq(T.gymMember.status, "activo")));
  const [{ n: newMembers }] = await db.select({ n: count() }).from(T.gymMember).where(and(eq(T.gymMember.organizationId, org), gte(T.gymMember.joinedAt, addDays(t0, -30))));
  const [{ n: expiring }] = await db.select({ n: count() }).from(T.membership).where(and(eq(T.membership.organizationId, org), eq(T.membership.status, "activa"), gte(T.membership.endsAt, t0), lte(T.membership.endsAt, addDays(t0, 7))));
  const [{ n: newLeads }] = await db.select({ n: count() }).from(T.lead).where(and(eq(T.lead.organizationId, org), eq(T.lead.status, "nuevo")));
  let revenueCents: number | null = null;
  if (withRevenue) {
    const [r] = await db.select({ s: sum(T.payment.amountCents) }).from(T.payment).where(and(eq(T.payment.organizationId, org), gte(T.payment.paidAt, new Date(Date.now() - 30 * 864e5))));
    revenueCents = Number(r.s ?? 0);
  }
  return { members, newMembers, expiring, newLeads, revenueCents };
}

/** Próximas clases con cupo libre. */
export async function classesWithRoom(org: string, limit: number) {
  const next = await db.select().from(T.gymClass)
    .where(and(eq(T.gymClass.organizationId, org), gte(T.gymClass.startsAt, new Date()))).orderBy(T.gymClass.startsAt).limit(10);
  if (!next.length) return [];
  const booked = await db.select({ classId: T.booking.classId, n: count() }).from(T.booking)
    .where(and(inArray(T.booking.classId, next.map((c) => c.id)), eq(T.booking.status, "reservada"))).groupBy(T.booking.classId);
  const taken = new Map(booked.map((b) => [b.classId, b.n]));
  return next.filter((c) => (taken.get(c.id) ?? 0) < c.capacity).slice(0, limit);
}

/** Socios por nombre o teléfono (máx. 10), cada uno con su membresía más lejana. */
export async function searchMembers(org: string, query: string) {
  const like = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const members = await db.select().from(T.gymMember)
    .where(and(eq(T.gymMember.organizationId, org), or(ilike(T.gymMember.name, like), ilike(T.gymMember.phone, like))))
    .orderBy(T.gymMember.name).limit(10);
  if (!members.length) return [];
  const rows = await db.select({ memberId: T.membership.memberId, status: T.membership.status, endsAt: T.membership.endsAt, plan: T.plan.name })
    .from(T.membership).innerJoin(T.plan, eq(T.plan.id, T.membership.planId))
    .where(and(eq(T.membership.organizationId, org), inArray(T.membership.memberId, members.map((m) => m.id)))).orderBy(desc(T.membership.endsAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.memberId)) latest.set(r.memberId, r);
  return members.map((m) => {
    const ms = latest.get(m.id);
    return { id: m.id, name: m.name, phone: m.phone, status: m.status, joinedAt: m.joinedAt, membership: ms ? { plan: ms.plan, status: ms.status, endsAt: ms.endsAt } : null };
  });
}

/** Último conteo de personas registrado. */
export async function latestOccupancy(org: string) {
  const [row] = await db.select().from(T.occupancyEvent).where(eq(T.occupancyEvent.organizationId, org)).orderBy(desc(T.occupancyEvent.at)).limit(1);
  return row ? { people: row.people, camera: row.camera, at: row.at } : null;
}

const FRESH_MS = 15 * 60_000; // una lectura de más de 15 min ya no describe "ahora" (la cámara pudo caerse)

/** Aforo actual frente al máximo configurado. `over` solo se activa con una lectura reciente. */
export async function occupancyNow(org: string, max: number) {
  const last = await latestOccupancy(org);
  if (!last) return null;
  const fresh = Date.now() - +last.at <= FRESH_MS;
  return { ...last, max, fresh, over: fresh && last.people > max };
}

/** Leads en estado "nuevo" de los últimos `days` días. */
export const newLeads = (org: string, days: number) =>
  db.select({ id: T.lead.id, name: T.lead.name, phone: T.lead.phone, source: T.lead.source, createdAt: T.lead.createdAt }).from(T.lead)
    .where(and(eq(T.lead.organizationId, org), eq(T.lead.status, "nuevo"), gte(T.lead.createdAt, new Date(Date.now() - days * 864e5)))).orderBy(desc(T.lead.createdAt));
