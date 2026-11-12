export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

/** Fetch contra el núcleo (mismo origen vía proxy). Lanza ApiError con el mensaje en español del servidor. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`/api${path}`, {
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
