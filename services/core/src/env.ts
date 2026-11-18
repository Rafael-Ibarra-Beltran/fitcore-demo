const e = process.env;
export const env = {
  databaseUrl: e.DATABASE_URL ?? "postgres://fitcore:fitcore@localhost:5432/fitcore",
  port: Number(e.PORT ?? 3000),
  authSecret: e.BETTER_AUTH_SECRET ?? "dev-secret-change-me-dev-secret-change-me",
  baseUrl: e.BASE_URL ?? "http://localhost:3000",
  // Orígenes permitidos (CORS y trustedOrigins), separados por coma.
  origins: (e.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4321,http://127.0.0.1:5173,http://127.0.0.1:4321").split(","),
  serviceKey: e.SERVICE_KEY ?? "dev-service-key",
  aiUrl: (e.AI_URL ?? "http://localhost:8000").replace(/\/$/, ""), // servicio de IA: respuestas del personal y reindexado del RAG
  mcpKey: e.MCP_API_KEY ?? "", // vacía = servidor MCP apagado (/mcp responde 404)
  ownerPhone: e.OWNER_PHONE ?? "", // a quien llegan el resumen semanal y los avisos al personal
  payUrlBase: (e.PAY_URL_BASE ?? "https://pago.ejemplo.test").replace(/\/$/, ""), // enlace de pago de ejemplo del recordatorio
  serviceOrgSlug: e.SERVICE_ORG_SLUG ?? "fitcore-demo",
  // Clave de prueba de Cloudflare que siempre pasa. Producción: clave real.
  turnstileSecret: e.TURNSTILE_SECRET ?? "1x0000000000000000000000000000000AA",
  chatTokenSecret: e.CHAT_TOKEN_SECRET ?? "dev-chat-secret-dev-chat-secret", // la misma en el servicio de IA, que verifica los tokens del chat
  demoMemberPhone: e.DEMO_MEMBER_PHONE ?? "+525500000000", // socio sembrado que usan los invitados del chat web
  skipTurnstile: e.SKIP_TURNSTILE === "1",
  occupancyMax: Number(e.OCCUPANCY_MAX ?? 40) || 40, // aforo máximo: el panel alerta al superarlo
  gymTz: e.GYM_TZ ?? "America/Mexico_City",
  cookieDomain: e.COOKIE_DOMAIN || undefined,
  demoEmail: "demo@fitcore.test",
  demoPassword: e.DEMO_PASSWORD ?? "demo-fitcore-2026",
};

if (env.mcpKey && env.mcpKey.length < 24) throw new Error("MCP_API_KEY debe tener al menos 24 caracteres (openssl rand -hex 32)");

// En producción no se arranca con secretos de desarrollo.
if (e.NODE_ENV === "production") {
  const missing = [
    "DATABASE_URL", "BASE_URL", "ALLOWED_ORIGINS", "AI_URL", "BETTER_AUTH_SECRET", "SERVICE_KEY", "CHAT_TOKEN_SECRET",
    ...(env.skipTurnstile ? [] : ["TURNSTILE_SECRET"]),
  ].filter((k) => !e[k]);
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
}
