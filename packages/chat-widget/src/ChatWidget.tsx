import { useEffect, useId, useRef, useState } from "react";
import { Card } from "./cards";
import { Check, Chat, Close, Copy, Dumbbell, Refresh, Send, Spark, Stop } from "./icons";
import { Markdown } from "./markdown";
import { useChat, type ChatConfig, type Msg } from "./useChat";

export type ChatWidgetProps = ChatConfig & {
  /** WhatsApp del gimnasio (solo dígitos con lada de país) para el botón de la tarjeta de escalado. */
  whatsapp?: string;
  title?: string;
};

const SUGGESTIONS = ["¿Qué clases hay hoy?", "¿Cuánta gente hay ahora?", "¿Qué planes y precios tienen?", "Quiero reservar una clase"];
const TOOL_LABEL: Record<string, string> = {
  buscar_conocimiento: "Consultando información del gimnasio",
  consultar_membresia: "Revisando tu membresía",
  listar_clases: "Buscando clases",
  reservar_clase: "Reservando tu lugar",
  consultar_ocupacion: "Midiendo el aforo",
  escalar_a_humano: "Avisando al personal",
};

function Bubble({ m, whatsapp, onAsk, last }: { m: Msg; whatsapp?: string; onAsk: (t: string) => void; last: boolean }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") return <div className="fcw-msg fcw-msg--user"><p>{m.text}</p></div>;
  const streaming = m.state === "streaming";
  const tools = m.tools.filter((t) => TOOL_LABEL[t]);
  const copy = () => navigator.clipboard?.writeText(m.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => null);
  return (
    <div className="fcw-msg fcw-msg--bot">
      <span className="fcw-avatar" aria-hidden><Dumbbell /></span>
      <div className="fcw-body">
        {tools.length > 0 && (
          <ul className="fcw-tools" aria-label="Acciones del asistente">
            {tools.map((t, i) => (
              <li key={t} className="fcw-tool" data-active={streaming && i === tools.length - 1 && !m.text}><Spark />{TOOL_LABEL[t]}{streaming && i === tools.length - 1 && !m.text ? "…" : ""}</li>
            ))}
          </ul>
        )}
        {m.text ? <div className="fcw-text" data-streaming={streaming}><Markdown text={m.text} /></div>
          : streaming && <span className="fcw-typing" aria-hidden><i /><i /><i /></span>}
        {m.cards.map((c, i) => <Card key={i} card={c} whatsapp={whatsapp} onAsk={onAsk} />)}
        {m.state === "error" && <p className="fcw-error" role="alert">{m.error}</p>}
        {m.state === "stopped" && <p className="fcw-hint">Respuesta detenida.</p>}
        {!streaming && m.text && last && (
          <button type="button" className="fcw-icon-btn" onClick={copy} aria-label={copied ? "Copiado" : "Copiar respuesta"}>{copied ? <Check /> : <Copy />}</button>
        )}
      </div>
    </div>
  );
}

export function ChatWidget({ whatsapp, title = "Asistente FitCore", ...cfg }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, send, stop, reset, busy, awake, wake, escalated, blocked } = useChat(cfg);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => { if (open) { wake(); input.current?.focus(); } }, [open, wake]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [messages]);
  const close = () => { setOpen(false); launcher.current?.focus(); };
  const submit = (t = draft) => { if (!t.trim()) return; send(t); setDraft(""); };
  const disabled = escalated || !!blocked;

  return (
    <div className="fcw">
      {/* <dialog> no modal: role dialog nativo. Siempre montado para poder animar la salida; cerrado es display:none. */}
      <dialog className="fcw-panel" open={open} aria-labelledby={titleId} onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="fcw-head">
          <span className="fcw-avatar fcw-avatar--lg" aria-hidden><Dumbbell /></span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p><span className="fcw-dot" data-state={awake} />{awake === "waking" ? "Despertando al asistente…" : "En línea · responde sobre el gimnasio"}</p>
          </div>
          <button type="button" className="fcw-icon-btn" onClick={reset} aria-label="Nueva conversación" title="Nueva conversación"><Refresh /></button>
          <button type="button" className="fcw-icon-btn" onClick={close} aria-label="Cerrar chat"><Close /></button>
        </div>

        <div ref={log} className="fcw-log" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversación">
          <div className="fcw-msg fcw-msg--bot">
            <span className="fcw-avatar" aria-hidden><Dumbbell /></span>
            <div className="fcw-body"><div className="fcw-text"><p>¡Hola! Soy el asistente de <strong>FitCore Gym</strong>. Puedo mostrarte clases, reservar tu lugar, revisar el aforo y resolver dudas de planes y reglamento.</p></div></div>
          </div>
          {messages.map((m, i) => <Bubble key={m.id} m={m} whatsapp={whatsapp} onAsk={submit} last={i === messages.length - 1} />)}
        </div>

        {messages.length === 0 && (
          <ul className="fcw-suggest" aria-label="Preguntas sugeridas">
            {SUGGESTIONS.map((s) => <li key={s}><button type="button" className="fcw-chip" onClick={() => submit(s)}>{s}</button></li>)}
          </ul>
        )}
        {blocked && (
          <p className="fcw-banner" role="alert">{blocked} <button type="button" className="fcw-link" onClick={reset}>Nueva conversación</button></p>
        )}

        <form className="fcw-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor={`${titleId}-in`} className="fcw-sr">Escribe tu mensaje</label>
          <textarea
            id={`${titleId}-in`} ref={input} rows={1} maxLength={1000} value={draft} disabled={disabled}
            placeholder={escalated ? "Un asesor te contactará" : "Pregunta por clases, planes o aforo"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return; // Enter que confirma una composición IME (Safari lo entrega ya sin isComposing)
                submit();
              }}
          />
          {busy
            ? <button type="button" className="fcw-send" onClick={stop} aria-label="Detener respuesta"><Stop /></button>
            : <button type="submit" className="fcw-send" disabled={disabled || !draft.trim()} aria-label="Enviar mensaje"><Send /></button>}
        </form>
        <p className="fcw-foot">Demo con datos ficticios · solo temas del gimnasio</p>
      </dialog>
      <button ref={launcher} type="button" className="fcw-launcher" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-label={open ? "Cerrar chat" : "Abrir chat con el asistente"} data-open={open}>
        {open ? <Close width={24} height={24} /> : <Chat width={26} height={26} />}
      </button>
    </div>
  );
}
