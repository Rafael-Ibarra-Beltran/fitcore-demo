import type { ChatCard } from "@fitcore/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { readEvents } from "./stream";
import { tokenGetter } from "./turnstile";

export type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  cards: ChatCard[];
  state: "streaming" | "done" | "stopped" | "error";
  error?: string;
};
type Session = { token: string; cid: string };
export type ChatConfig = {
  aiUrl: string;
  coreUrl: string;
  /** Clave pública de Turnstile. Se exige siempre para abrir una sesión de chat. */
  turnstileSiteKey: string;
};

const KEY = "fitcore-chat-v1";
const uid = () => Math.random().toString(36).slice(2);
// sessionStorage puede lanzar (ventana privada, datos bloqueados): el chat funciona igual, solo sin persistencia.
const empty = { session: null, messages: [] as Msg[], escalated: false };
// El token vence a las 2 h: un chat guardado con token vencido ya no tiene contexto en el servidor, así que se empieza limpio.
const expired = (token: string) => { try { return JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).e * 1000 < Date.now(); } catch { return true; } };
const load = (): { session: Session | null; messages: Msg[]; escalated: boolean } => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (raw?.session && expired(raw.session.token)) return empty;
    if (raw) return { ...raw, messages: raw.messages.map((m: Msg) => (m.state === "streaming" ? { ...m, state: "stopped" } : m)) };
  } catch { /* sin persistencia */ }
  return empty;
};

export function useChat(cfg: ChatConfig) {
  const init = useRef(load()).current;
  const [messages, setMessages] = useState<Msg[]>(init.messages);
  const [escalated, setEscalated] = useState(init.escalated);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [awake, setAwake] = useState<"idle" | "waking" | "ready">("idle");
  const session = useRef<Session | null>(init.session);
  const abort = useRef<AbortController | null>(null);
  const getToken = useRef<(() => Promise<string>) | null>(null);
  const busy = messages.at(-1)?.state === "streaming";

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ session: session.current, messages, escalated })); } catch { /* sin persistencia */ }
  }, [messages, escalated]);

  /** Render duerme el servicio de IA: el primer ping lo despierta mientras la persona lee la bienvenida. */
  const wake = useCallback(() => {
    if (awake !== "idle") return;
    setAwake("waking");
    fetch(`${cfg.aiUrl}/health`, { signal: AbortSignal.timeout(60_000) }).catch(() => null).finally(() => setAwake("ready"));
  }, [awake, cfg.aiUrl]);

  const patch = (id: string, f: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === id ? f(m) : m)));

  async function newSession(): Promise<Session> {
    const turnstileToken = await (getToken.current ??= tokenGetter(cfg.turnstileSiteKey))().catch(() => "");
    const r = await fetch(`${cfg.coreUrl}/api/public/chat/session`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken }),
    }).catch(() => null);
    if (!r) throw new Error("No hay conexión con el servidor.");
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 429 ? "Demasiados intentos, espera un minuto." : (data.error ?? "No pudimos iniciar el chat."));
    return (session.current = { token: data.token, cid: data.conversationId });
  }

  const send = useCallback(async (text: string, retried = false) => {
    text = text.trim();
    if (!text || busy || escalated || blocked) return;
    const ctl = (abort.current = new AbortController());
    const id = uid();
    if (!retried) setMessages((ms) => [...ms, { id: uid(), role: "user", text, tools: [], cards: [], state: "done" }, { id, role: "assistant", text: "", tools: [], cards: [], state: "streaming" }]);
    else setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, id, text: "", tools: [], cards: [], state: "streaming" } : m)));
    try {
      const s = session.current ?? (await newSession());
      const r = await fetch(`${cfg.aiUrl}/chat/stream`, {
        method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` }, body: JSON.stringify({ message: text }),
      });
      if (r.status === 401 && !retried) { session.current = null; setEscalated(false); return send(text, true); } // el token vence a las 2 h
      if (r.status === 429) throw new Error("Demasiadas solicitudes, espera un momento.");
      if (!r.ok || !r.body) throw new Error("El asistente no respondió. Intenta de nuevo.");
      for await (const ev of readEvents(r.body)) {
        if (ev.event === "token") patch(id, (m) => ({ ...m, text: m.text + ev.data.text }));
        else if (ev.event === "tool") patch(id, (m) => ({ ...m, tools: [...new Set([...m.tools, ev.data.name])] }));
        else if (ev.event === "card") {
          if (ev.data.kind === "escalado") setEscalated(true);
          patch(id, (m) => ({ ...m, cards: [...m.cards, ev.data] }));
        } else if (ev.event === "error") {
          if (ev.data.status === 429) setBlocked(ev.data.message);
          patch(id, (m) => ({ ...m, state: "error", error: ev.data.message }));
          return;
        } else if (ev.event === "done" && ev.data.escalated) setEscalated(true);
      }
      patch(id, (m) => (m.state === "streaming" ? { ...m, state: "done" } : m));
    } catch (e) {
      if (ctl.signal.aborted) return patch(id, (m) => ({ ...m, state: "stopped" }));
      patch(id, (m) => ({ ...m, state: "error", error: e instanceof Error ? e.message : "Algo salió mal." }));
    }
  }, [busy, escalated, blocked, cfg.aiUrl, cfg.coreUrl, cfg.turnstileSiteKey]);

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    session.current = null;
    setMessages([]); setEscalated(false); setBlocked(null);
  }, []);

  return { messages, send, stop, reset, busy, awake, wake, escalated, blocked };
}
