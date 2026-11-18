import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, vector, date } from "drizzle-orm/pg-core";
import { organization } from "./auth-schema";

export * from "./auth-schema";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const orgId = () =>
  text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at").defaultNow().notNull();

export const gymMember = pgTable("gym_member", {
  id: id(), organizationId: orgId(),
  name: text("name").notNull(),
  phone: text("phone").notNull(), // WhatsApp, formato E.164
  status: text("status", { enum: ["activo", "inactivo"] }).notNull().default("activo"),
  joinedAt: date("joined_at").notNull().default(sql`current_date`),
}, (t) => [index().on(t.organizationId, t.phone)]);

export const plan = pgTable("plan", {
  id: id(), organizationId: orgId(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  durationDays: integer("duration_days").notNull(),
});

export const membership = pgTable("membership", {
  id: id(), organizationId: orgId(),
  memberId: text("member_id").notNull().references(() => gymMember.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plan.id),
  startsAt: date("starts_at").notNull(),
  endsAt: date("ends_at").notNull(),
  status: text("status", { enum: ["activa", "vencida", "cancelada"] }).notNull().default("activa"),
}, (t) => [index().on(t.organizationId, t.endsAt)]);

export const payment = pgTable("payment", {
  id: id(), organizationId: orgId(),
  membershipId: text("membership_id").notNull().references(() => membership.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: ["efectivo", "tarjeta", "transferencia"] }).notNull(),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
});

export const gymClass = pgTable("class", {
  id: id(), organizationId: orgId(),
  name: text("name").notNull(),
  instructor: text("instructor").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  capacity: integer("capacity").notNull(),
});

export const booking = pgTable("booking", {
  id: id(), organizationId: orgId(),
  classId: text("class_id").notNull().references(() => gymClass.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => gymMember.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["reservada", "cancelada", "asistio"] }).notNull().default("reservada"),
  createdAt: createdAt(),
});

export const attendance = pgTable("attendance", {
  id: id(), organizationId: orgId(),
  memberId: text("member_id").notNull().references(() => gymMember.id, { onDelete: "cascade" }),
  checkedInAt: timestamp("checked_in_at").defaultNow().notNull(),
}, (t) => [index().on(t.organizationId, t.checkedInAt)]);

export const lead = pgTable("lead", {
  id: id(), organizationId: orgId(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  source: text("source", { enum: ["landing", "whatsapp"] }).notNull(),
  status: text("status", { enum: ["nuevo", "contactado", "convertido"] }).notNull().default("nuevo"),
  createdAt: createdAt(),
});

export const conversation = pgTable("conversation", {
  id: id(), organizationId: orgId(),
  channel: text("channel", { enum: ["whatsapp", "web"] }).notNull(),
  memberId: text("member_id").references(() => gymMember.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => lead.id, { onDelete: "set null" }),
  escalated: integer("escalated").notNull().default(0), // 0/1, para el personal
  createdAt: createdAt(),
});

export const message = pgTable("message", {
  id: id(), organizationId: orgId(),
  conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "staff"] }).notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
}, (t) => [index().on(t.conversationId, t.createdAt)]); // historial y conteos del chat: por conversación y fecha

// Tablas del RAG: las escribe el servicio de IA con SQL directo; solo el núcleo las migra.
export const kbDocument = pgTable("kb_document", {
  id: id(), organizationId: orgId(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
});

export const kbChunk = pgTable("kb_chunk", {
  id: id(), organizationId: orgId(),
  documentId: text("document_id").notNull().references(() => kbDocument.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
}, (t) => [index("kb_chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))]);

export const occupancyEvent = pgTable("occupancy_event", {
  id: id(), organizationId: orgId(),
  camera: text("camera").notNull(),
  people: integer("people").notNull(),
  at: timestamp("at").defaultNow().notNull(),
}, (t) => [index().on(t.organizationId, t.at)]);

export const automationLog = pgTable("automation_log", {
  id: id(), organizationId: orgId(),
  type: text("type").notNull(),
  recipient: text("recipient").notNull(),
  result: text("result").notNull(),
  // Clave de idempotencia: un reintento no duplica el mensaje.
  dedupeKey: text("dedupe_key").unique(),
  at: timestamp("at").defaultNow().notNull(),
});
