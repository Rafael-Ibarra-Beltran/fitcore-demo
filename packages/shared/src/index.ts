import { z } from "zod";

export const APP_NAME = "FitCore"; // nombre provisional, un solo lugar

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const phone = z.string().regex(/^\+?\d{10,15}$/, "Teléfono con 10 a 15 dígitos");
const name = z.string().trim().min(2, "Mínimo 2 caracteres").max(100);

export const memberInput = z.object({
  name, phone,
  status: z.enum(["activo", "inactivo"]).default("activo"),
  joinedAt: day.optional(),
});
export const planInput = z.object({
  name,
  priceCents: z.number().int().min(0),
  durationDays: z.number().int().min(1).max(3650),
});
export const membershipInput = z.object({
  memberId: z.string(), planId: z.string(),
  startsAt: day.optional(), // endsAt lo calcula el servidor con la duración del plan
  status: z.enum(["activa", "vencida", "cancelada"]).optional(),
});
export const paymentInput = z.object({
  membershipId: z.string(),
  amountCents: z.number().int().min(1),
  method: z.enum(["efectivo", "tarjeta", "transferencia"]),
});
export const classInput = z.object({
  name, instructor: name,
  startsAt: z.coerce.date(),
  capacity: z.number().int().min(1).max(500),
});
export const bookingInput = z.object({
  classId: z.string(), memberId: z.string(),
  status: z.enum(["reservada", "cancelada", "asistio"]).optional(),
});
export const attendanceInput = z.object({ memberId: z.string(), checkedInAt: z.coerce.date().optional() });
export const leadInput = z.object({
  name, phone,
  source: z.enum(["landing", "whatsapp"]).default("landing"),
  status: z.enum(["nuevo", "contactado", "convertido"]).default("nuevo"),
});
export const publicLeadInput = z.object({ name, phone, turnstileToken: z.string().optional() });
export const occupancyInput = z.object({
  camera: z.string().min(1), people: z.number().int().min(0),
  at: z.coerce.date().optional(),
});
export const conversationInput = z.object({
  channel: z.enum(["whatsapp", "web"]),
  memberId: z.string().optional(), leadId: z.string().optional(),
  escalated: z.number().int().min(0).max(1).optional(),
});
export const messageInput = z.object({
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "staff"]),
  content: z.string().min(1).max(4000),
});

export const kbDocumentInput = z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(20000) });
export const replyInput = z.object({ text: z.string().min(1).max(1000) });

/** Convierte centavos a texto MXN. */
export const mxn = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

// ---------- Chat web (eventos SSE de POST /chat/stream del servicio de IA) ----------
export const chatCard = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clases"), items: z.array(z.object({ id: z.string(), nombre: z.string(), instructor: z.string(), inicio: z.string(), cupoLibre: z.number() })) }),
  z.object({ kind: z.literal("membresia"), socio: z.string(), estado: z.string(), vence: z.string() }),
  z.object({ kind: z.literal("ocupacion"), personas: z.number(), aforo: z.number().nullish(), lleno: z.boolean() }),
  z.object({ kind: z.literal("reserva"), ok: z.boolean(), mensaje: z.string() }),
  z.object({ kind: z.literal("escalado") }),
  z.object({ kind: z.literal("fuera_de_tema") }),
]);
export type ChatCard = z.infer<typeof chatCard>;

export const chatEvent = z.discriminatedUnion("event", [
  z.object({ event: z.literal("tool"), data: z.object({ name: z.string() }) }),
  z.object({ event: z.literal("card"), data: chatCard }),
  z.object({ event: z.literal("token"), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal("done"), data: z.object({ conversationId: z.string(), escalated: z.boolean() }) }),
  z.object({ event: z.literal("error"), data: z.object({ message: z.string(), status: z.number() }) }),
]);
export type ChatEvent = z.infer<typeof chatEvent>;
