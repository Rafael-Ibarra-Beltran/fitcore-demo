import { createMcpHandler, McpServer, originValidationResponse } from "@modelcontextprotocol/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "./db";
import * as T from "./db/schema";
import { env } from "./env";
import { businessStats, classesWithRoom, expiringMemberships, inactiveMembers, newLeads, occupancyNow, searchMembers } from "./queries";
import { rateLimit } from "./ratelimit";

const out = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const days = (def: number) => z.number().int().min(0).max(3650).optional().describe(`Días (por defecto ${def})`);
const readOnly = { readOnlyHint: true };

/** Herramientas de solo lectura. La organización la fija el servidor: ninguna herramienta recibe un id de organización. */
function buildServer(org: string) {
  const server = new McpServer({ name: "fitcore", version: "0.1.0" });
  const annotations = { readOnlyHint: true };

  server.registerTool("resumen_negocio", {
    description: "Cifras del negocio: socios activos, altas de los últimos 30 días, membresías que vencen en 7 días, leads nuevos e ingresos de 30 días (centavos MXN).",
    inputSchema: z.object({}), annotations,
  }, async () => out(await businessStats(org, true)));

  server.registerTool("socios_inactivos", {
    description: "Socios activos que no han asistido en los últimos N días (o nunca), con su última visita.",
    inputSchema: z.object({ dias: days(30) }), annotations,
  }, async ({ dias }) => out(await inactiveMembers(org, dias ?? 30)));

  server.registerTool("membresias_por_vencer", {
    description: "Membresías activas que vencen en los próximos N días, con nombre y teléfono del socio.",
    inputSchema: z.object({ dias: days(3) }), annotations,
  }, async ({ dias }) => out(await expiringMemberships(org, dias ?? 3)));

  server.registerTool("buscar_socio", {
    description: "Busca socios por nombre o teléfono (máximo 10) y muestra su membresía más reciente.",
    inputSchema: z.object({ consulta: z.string().min(2).max(100).describe("Parte del nombre o del teléfono") }), annotations,
  }, async ({ consulta }) => out(await searchMembers(org, consulta)));

  server.registerTool("clases_proximas", {
    description: "Próximas clases con cupo libre (hasta 8). `dia` opcional en formato AAAA-MM-DD.",
    inputSchema: z.object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), annotations,
  }, async ({ dia }) => out((await classesWithRoom(org, 40))
    .filter((c) => !dia || c.startsAt.toISOString().slice(0, 10) === dia).slice(0, 8)
    .map((c) => ({ id: c.id, nombre: c.name, instructor: c.instructor, inicio: c.startsAt, cupo: c.capacity }))));

  server.registerTool("aforo_actual", {
    description: "Último conteo de personas en el gimnasio, cuándo se registró, el aforo máximo y si lo supera (solo con lectura de los últimos 15 min).",
    inputSchema: z.object({}), annotations,
  }, async () => out((await occupancyNow(org, env.occupancyMax)) ?? "Sin datos de aforo."));

  server.registerTool("leads_nuevos", {
    description: "Leads en estado 'nuevo' de los últimos N días.",
    inputSchema: z.object({ dias: days(7) }), annotations,
  }, async ({ dias }) => out(await newLeads(org, dias ?? 7)));

  return server;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const mcpApp = new Hono();
mcpApp.use("*", rateLimit(120, 60_000));
mcpApp.all("/", async (c) => {
  if (!env.mcpKey) return c.json({ error: "No encontrado" }, 404);
  // Contra DNS rebinding: si el cliente manda Origin (un navegador), debe ser uno de los orígenes permitidos.
  const rejected = originValidationResponse(c.req.raw, env.origins.map((o) => new URL(o).hostname));
  if (rejected) return rejected;
  const key = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? c.req.header("x-api-key") ?? "";
  if (!same(key, env.mcpKey)) return c.json({ error: "No autorizado" }, 401);
  const [org] = await db.select({ id: T.organization.id }).from(T.organization).where(eq(T.organization.slug, env.serviceOrgSlug)).limit(1);
  if (!org) return c.json({ error: "Organización no existe" }, 500);
  return createMcpHandler(() => buildServer(org.id)).fetch(c.req.raw); // sin estado: un servidor nuevo por petición
});
