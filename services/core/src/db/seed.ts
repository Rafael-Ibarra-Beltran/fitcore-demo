import { eq, inArray } from "drizzle-orm";
import { auth } from "../auth";
import { env } from "../env";
import { db, sql } from ".";
import * as T from "./schema";

// PRNG determinista: el seed produce siempre los mismos datos.
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <X>(a: X[]) => a[Math.floor(rnd() * a.length)];
const day = (offset: number) => new Date(Date.now() + offset * 864e5);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Limpia una corrida previa (el borrado de la organización cascadea a los datos de negocio).
await db.delete(T.organization).where(eq(T.organization.slug, env.serviceOrgSlug));
await db.delete(T.user).where(inArray(T.user.email, [env.demoEmail, "staff@fitcore.test"]));

const mkUser = async (name: string, email: string) =>
  (await auth.api.signUpEmail({ body: { name, email, password: env.demoPassword } })).user.id;
const ownerId = await mkUser("Dueño Demo", env.demoEmail);
const staffId = await mkUser("Recepción Demo", "staff@fitcore.test");

const [org] = await db.insert(T.organization).values({
  id: crypto.randomUUID(), name: "FitCore Gym (demo)", slug: env.serviceOrgSlug, createdAt: new Date(),
  metadata: JSON.stringify({ modules: ["landing", "admin"] }),
}).returning();
await db.insert(T.member).values([
  { id: crypto.randomUUID(), organizationId: org.id, userId: ownerId, role: "owner", createdAt: new Date() },
  { id: crypto.randomUUID(), organizationId: org.id, userId: staffId, role: "staff", createdAt: new Date() },
]);
const organizationId = org.id;

const plans = await db.insert(T.plan).values([
  { organizationId, name: "Mensual", priceCents: 59900, durationDays: 30 },
  { organizationId, name: "Trimestral", priceCents: 149900, durationDays: 90 },
  { organizationId, name: "Anual", priceCents: 499000, durationDays: 365 },
]).returning();

const first = ["Ana", "Luis", "María", "Carlos", "Sofía", "Jorge", "Valeria", "Diego", "Fernanda", "Miguel", "Daniela", "Andrés", "Paola", "Ricardo", "Camila", "Héctor", "Regina", "Pablo", "Lucía", "Iván"];
const last = ["García", "Hernández", "López", "Martínez", "Rodríguez", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores"];
const members = await db.insert(T.gymMember).values(
  Array.from({ length: 40 }, (_, i) => ({
    organizationId, name: `${first[i % 20]} ${pick(last)}`,
    phone: `+52155${String(10000000 + Math.floor(rnd() * 89999999))}`,
    status: i < 36 ? ("activo" as const) : ("inactivo" as const),
    joinedAt: iso(day(-Math.floor(rnd() * 300))),
  })),
).returning();

// Vencimientos repartidos: algunos vencidos, varios en los próximos 7 días.
const memberships = await db.insert(T.membership).values(members.map((m, i) => {
  const plan = plans[i % 3 === 2 ? 1 : 0];
  const ends = i < 6 ? -Math.ceil(rnd() * 20) : i < 14 ? Math.ceil(rnd() * 7) : 10 + Math.floor(rnd() * 80);
  return {
    organizationId, memberId: m.id, planId: plan.id,
    startsAt: iso(day(ends - plan.durationDays)), endsAt: iso(day(ends)),
    status: ends < 0 ? ("vencida" as const) : ("activa" as const),
  };
})).returning();
await db.insert(T.payment).values(memberships.map((ms, i) => {
  const plan = plans.find((p) => p.id === ms.planId)!;
  return { organizationId, membershipId: ms.id, amountCents: plan.priceCents, method: pick(["efectivo", "tarjeta", "transferencia"] as const), paidAt: day(-Math.floor(rnd() * 28)) };
}));

// Clases de los próximos 7 días; la primera con cupo 2 y llena para probar la regla.
const names = [["Spinning", "Mariana"], ["Yoga", "Laura"], ["CrossFit", "Beto"], ["Zumba", "Karen"], ["Funcional", "Omar"]];
const classRows = [];
for (let d = 0; d < 7; d++)
  for (const h of [7, 12, 19]) {
    const [name, instructor] = pick(names);
    const at = day(d); at.setUTCHours(h + 6, 0, 0, 0);
    classRows.push({ organizationId, name, instructor, startsAt: at, capacity: 12 });
  }
// Clase de cupo 2 ya llena, mañana a las 19:00 (hora de México), para demostrar la regla de cupo.
const full = day(1); full.setUTCHours(19 + 6, 0, 0, 0);
classRows.push({ organizationId, name: "Yoga (cupo limitado)", instructor: "Laura", startsAt: full, capacity: 2 });
const classes = await db.insert(T.gymClass).values(classRows).returning();
const fullClass = classes.find((c) => c.capacity === 2)!;
await db.insert(T.booking).values([
  { organizationId, classId: fullClass.id, memberId: members[20].id },
  { organizationId, classId: fullClass.id, memberId: members[21].id },
  ...members.slice(22, 28).map((m) => ({ organizationId, classId: classes[1].id, memberId: m.id })),
]);

// Asistencia de 90 días; los socios 30-35 no vienen hace más de 30 días.
const att = [];
members.slice(0, 36).forEach((m, i) => {
  const maxBack = i >= 30 ? 90 : 60;
  const minBack = i >= 30 ? 31 : 0;
  for (let k = 0; k < 25; k++) {
    const d = day(-(minBack + Math.floor(rnd() * (maxBack - minBack))));
    d.setHours(6 + Math.floor(rnd() * 15), Math.floor(rnd() * 60));
    att.push({ organizationId, memberId: m.id, checkedInAt: d });
  }
});
await db.insert(T.attendance).values(att);

await db.insert(T.lead).values(Array.from({ length: 8 }, (_, i) => ({
  organizationId, name: `${pick(first)} ${pick(last)}`, phone: `+52155${String(20000000 + Math.floor(rnd() * 79999999))}`,
  source: i % 3 === 0 ? ("whatsapp" as const) : ("landing" as const),
  status: pick(["nuevo", "nuevo", "contactado", "convertido"] as const), createdAt: day(-Math.floor(rnd() * 10)),
})));

// Ocupación de ayer y hoy, con picos a las 7 y las 19 h.
const occ = [];
for (const back of [1, 0])
  for (let h = 6; h <= 22; h++) {
    if (back === 0 && h + 6 > new Date().getUTCHours()) break;
    const base = h === 7 || h === 19 ? 34 : h === 8 || h === 18 || h === 20 ? 24 : h >= 12 && h <= 14 ? 16 : 8;
    const at = day(-back); at.setUTCHours(h + 6, 30, 0, 0);
    occ.push({ organizationId, camera: "sala-principal", people: Math.max(0, base + Math.floor(rnd() * 7) - 3), at });
  }
await db.insert(T.occupancyEvent).values(occ);

await db.insert(T.kbDocument).values([
  { organizationId, title: "Reglamento", content: "Toalla obligatoria. Prohibido grabar a otros socios. Casilleros se vacían al cierre." },
  { organizationId, title: "Planes y precios", content: "Mensual $599, Trimestral $1,499, Anual $4,990 MXN." },
  { organizationId, title: "Horarios", content: "Lunes a viernes 6:00 a 22:00, sábados 8:00 a 14:00, domingos cerrado." },
  { organizationId, title: "Preguntas frecuentes", content: "Puedes congelar tu membresía hasta 15 días por viaje o lesión. Primera clase de prueba gratis." },
]);

console.log(`seed listo: demo ${env.demoEmail} / ${env.demoPassword}`);
await sql.end();
