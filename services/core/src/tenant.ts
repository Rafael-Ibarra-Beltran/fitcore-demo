import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth";
import { db } from "./db";
import { member, organization } from "./db/schema";
import { env } from "./env";

export type Role = "owner" | "staff" | "service";
export type Env = { Variables: { orgId: string; role: Role } };

/** La organización sale de la sesión o de la clave de servicio, nunca del cuerpo. */
export const tenant = createMiddleware<Env>(async (c, next) => {
  const key = c.req.header("x-service-key");
  if (key) {
    if (key !== env.serviceKey) return c.json({ error: "Clave de servicio inválida" }, 401);
    // Sin caché: una consulta indexada por petición evita apuntar a una organización borrada tras re-sembrar.
    const org = await db.query.organization.findFirst({ where: eq(organization.slug, env.serviceOrgSlug) });
    if (!org) return c.json({ error: "Organización de servicio no existe" }, 500);
    c.set("orgId", org.id);
    c.set("role", "service");
    return next();
  }
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  const orgId = s?.session.activeOrganizationId;
  if (!s || !orgId) return c.json({ error: "No autenticado" }, 401);
  const m = await db.query.member.findFirst({ where: and(eq(member.userId, s.user.id), eq(member.organizationId, orgId)) });
  if (!m) return c.json({ error: "Sin acceso a la organización" }, 403);
  c.set("orgId", orgId);
  c.set("role", m.role === "owner" ? "owner" : "staff");
  return next();
});

export const requireRole = (...roles: Role[]) =>
  createMiddleware<Env>(async (c, next) =>
    roles.includes(c.get("role")) ? next() : c.json({ error: "Permiso insuficiente" }, 403));
