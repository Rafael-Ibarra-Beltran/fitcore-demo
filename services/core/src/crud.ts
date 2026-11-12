import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z, type ZodObject } from "zod";
import { db } from "./db";
import { requireRole, type Env, type Role } from "./tenant";

/** Registro para publicar el contrato OpenAPI sin duplicar esquemas. */
export const registry: { path: string; method: string; schema?: z.ZodType }[] = [];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Opts = {
  path: string;
  table: any; // shortcut: tabla genérica sin tipado, se tipa por recurso si crece
  create: ZodObject<any>;
  patch?: ZodObject<any>;
  /** Campos que apuntan a otra tabla: se verifica que pertenezcan a la misma organización. */
  refs?: Record<string, PgTable>;
  writeRoles?: Role[];
  readRoles?: Role[];
  insert?: (tx: Tx, orgId: string, input: any) => Promise<any>;
  noDelete?: boolean;
  /** Columna de orden y sentido; por defecto createdAt desc. */
  order?: [string, "asc" | "desc"];
};

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

export function crud(o: Opts) {
  const app = new Hono<Env>();
  const t = o.table;
  const cols = getTableColumns(t);
  // GET usa readRoles; el resto de métodos, writeRoles.
  app.use("*", (c, next) => {
    const roles = c.req.method === "GET" ? o.readRoles : o.writeRoles;
    return roles ? requireRole(...roles)(c, next) : next();
  });
  const patchSchema = o.patch ?? o.create.partial();
  const own = (orgId: string, extra?: any) => and(eq(t.organizationId, orgId), extra);

  async function checkRefs(tx: Tx, orgId: string, input: Record<string, unknown>) {
    for (const [field, table] of Object.entries(o.refs ?? {})) {
      const v = input[field];
      if (v === undefined) continue;
      const found = await tx.select({ id: (table as any).id }).from(table as any)
        .where(and(eq((table as any).id, v as string), eq((table as any).organizationId, orgId))).limit(1);
      if (!found.length) throw bad(`${field} no existe`);
    }
  }

  app.get("/", async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 200) || 200, 500);
    // Cualquier query que coincida con una columna filtra por igualdad.
    const filters = Object.keys(cols).filter((k) => k in q && k !== "limit").map((k) => eq(t[k], q[k]));
    const [oc, dir] = o.order ?? ["createdAt", "desc"];
    const order = cols[oc] ?? cols.id;
    const rows = await db.select().from(t)
      .where(and(eq(t.organizationId, c.get("orgId")), ...filters)).orderBy((dir === "asc" ? asc : desc)(order)).limit(limit);
    return c.json(rows);
  });

  app.get("/:id", async (c) => {
    const [row] = await db.select().from(t).where(own(c.get("orgId"), eq(t.id, c.req.param("id")))).limit(1);
    return row ? c.json(row) : c.json({ error: "No encontrado" }, 404);
  });

  app.post("/", zValidator("json", o.create), async (c) => {
    const orgId = c.get("orgId");
    const input = c.req.valid("json") as Record<string, unknown>;
    const row = await db.transaction(async (tx) => {
      await checkRefs(tx, orgId, input);
      if (o.insert) return o.insert(tx, orgId, input);
      return (await tx.insert(t).values({ ...input, organizationId: orgId }).returning())[0];
    });
    return c.json(row, 201);
  });

  app.patch("/:id", zValidator("json", patchSchema), async (c) => {
    const orgId = c.get("orgId");
    const input = c.req.valid("json") as Record<string, unknown>;
    if (!Object.keys(input).length) throw bad("Nada que actualizar");
    const row = await db.transaction(async (tx) => {
      await checkRefs(tx, orgId, input);
      return (await tx.update(t).set(input).where(own(orgId, eq(t.id, c.req.param("id")))).returning())[0];
    });
    return row ? c.json(row) : c.json({ error: "No encontrado" }, 404);
  });

  if (!o.noDelete)
    app.delete("/:id", async (c) => {
      const [row] = await db.delete(t).where(own(c.get("orgId"), eq(t.id, c.req.param("id")))).returning();
      return row ? c.json({ ok: true }) : c.json({ error: "No encontrado" }, 404);
    });

  registry.push(
    { path: o.path, method: "get" }, { path: o.path, method: "post", schema: o.create },
    { path: `${o.path}/{id}`, method: "get" }, { path: `${o.path}/{id}`, method: "patch", schema: patchSchema },
    ...(o.noDelete ? [] : [{ path: `${o.path}/{id}`, method: "delete" }]),
  );
  return app;
}
