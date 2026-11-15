export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

// En desarrollo vacío: mismo origen vía el proxy de Vite. En producción: VITE_API_URL=https://api.tudominio.com (se fija al hacer el build).
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

/** Fetch contra el núcleo. Lanza ApiError con el mensaje en español del servidor. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${API_URL}/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "include",
  }).catch(() => { throw new ApiError("No hay conexión con el servidor", 0) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error ?? data.error?.message ?? (data.success === false ? "Datos inválidos" : "Error");
    throw new ApiError(typeof msg === "string" ? msg : "Datos inválidos", r.status);
  }
  return data as T;
}
