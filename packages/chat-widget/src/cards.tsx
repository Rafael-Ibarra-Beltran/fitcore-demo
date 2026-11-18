import type { ChatCard } from "@fitcore/shared";
import { Dumbbell } from "./icons";

const when = (iso: string) => {
  const [d, t] = iso.split(" ");
  const date = new Date(`${d}T00:00:00`);
  return `${new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" }).format(date)} · ${t}`;
};

export function Card({ card, whatsapp, onAsk }: { card: ChatCard; whatsapp?: string; onAsk: (t: string) => void }) {
  switch (card.kind) {
    case "clases":
      return (
        <ul className="fcw-card fcw-classes" aria-label="Clases disponibles">
          {card.items.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.nombre}</strong>
                <span>{c.instructor} · {when(c.inicio)}</span>
              </div>
              {c.cupoLibre > 0
                ? <button type="button" className="fcw-pill" onClick={() => onAsk(`Quiero reservar la clase de ${c.nombre} del ${c.inicio} (id ${c.id})`)}>Reservar · {c.cupoLibre} lugares</button>
                : <span className="fcw-badge fcw-badge--warn">Llena</span>}
            </li>
          ))}
        </ul>
      );
    case "membresia":
      return (
        <div className="fcw-card fcw-stat">
          <span className="fcw-stat__label">Membresía de {card.socio}</span>
          <strong className="fcw-stat__value">{card.estado}</strong>
          <span>Vence el {card.vence}</span>
        </div>
      );
    case "ocupacion": {
      const pct = card.aforo ? Math.min(100, Math.round((card.personas / card.aforo) * 100)) : null;
      return (
        <div className="fcw-card fcw-stat">
          <span className="fcw-stat__label">Aforo ahora</span>
          <strong className="fcw-stat__value">{card.personas}{card.aforo ? <small> / {card.aforo}</small> : null} personas</strong>
          {pct !== null && (
            <div className="fcw-meter" role="meter" aria-label="Ocupación" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} data-full={card.lleno}>
              <span style={{ inlineSize: `${pct}%` }} />
            </div>
          )}
        </div>
      );
    }
    case "reserva":
      return <div className={`fcw-card fcw-note ${card.ok ? "fcw-note--ok" : "fcw-note--bad"}`} role="status">{card.ok ? "Reserva confirmada." : card.mensaje}</div>;
    case "escalado":
      return (
        <div className="fcw-card fcw-note" role="status">
          <strong>Un asesor te contactará</strong>
          <span>Ya avisé al personal. Si es urgente, escríbenos directo.</span>
          {whatsapp && <a className="fcw-pill" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>}
        </div>
      );
    case "fuera_de_tema":
      return <div className="fcw-card fcw-note"><Dumbbell /> Solo atiendo temas del gimnasio: clases, planes, membresía y aforo.</div>;
  }
}
