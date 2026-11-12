import { env } from "./env";
import type { Notify } from "./jobs";

/** Llamada al servicio de IA con la clave de servicio. Devuelve estado y cuerpo tal cual, o 503 si no responde. */
export async function callAi(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  try {
    const r = await fetch(env.aiUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": env.serviceKey },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(60_000), // reindexar llama al proveedor de embeddings
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return { status: 503, data: { detail: "El servicio de IA no responde" } };
  }
}

/** Envío real de las automatizaciones: el servicio de IA habla con WhatsApp y dice si salió o se simuló. */
export const notifyViaAi: Notify = async (m) => {
  const { status, data } = await callAi("/notify", m);
  if (status >= 400) throw new Error(data.detail ?? `Servicio de IA respondió ${status}`);
  return data.sent ? "enviado" : "simulado";
};
