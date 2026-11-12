import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";

export const auth = betterAuth({
  secret: env.authSecret,
  baseURL: env.baseUrl,
  basePath: "/api/auth",
  trustedOrigins: env.origins,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  advanced: env.cookieDomain
    ? { crossSubDomainCookies: { enabled: true, domain: env.cookieDomain } }
    : undefined,
  plugins: [organization()],
  databaseHooks: {
    session: {
      create: {
        // Activa la primera organización del usuario al iniciar sesión.
        before: async (session) => {
          const m = await db.query.member.findFirst({ where: eq(schema.member.userId, session.userId) });
          return { data: { ...session, activeOrganizationId: m?.organizationId ?? null } };
        },
      },
    },
  },
});
