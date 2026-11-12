"""Un mensaje entrante: identifica al contacto, aplica límites, ejecuta el agente y guarda el intercambio."""
from datetime import datetime

from . import agent, config, core, tools, whatsapp
from .tools import Ctx

LIMIT_MSG = "Llegaste al límite de mensajes de hoy. Mañana con gusto te atiendo, o pasa a recepción."
HUMAN_MSG = "Un miembro del equipo te responderá en breve."


def phone_variants(raw: str) -> list[str]:
    """Formas E.164 con las que puede estar guardado un móvil de México: +52 + 10 dígitos y +521 + 10 dígitos."""
    d = "".join(ch for ch in raw if ch.isdigit())
    out = ["+" + d]
    if d.startswith("521") and len(d) == 13:
        out.append("+52" + d[3:])
    elif d.startswith("52") and len(d) == 12:
        out.append("+521" + d[2:])
    return out


def _find_by_phone(path: str, variants: list[str]):
    return next((r for v in variants if (r := _first(core.get(path, phone=v)))), None)


def _first(rows):
    return rows[0] if rows else None


def _conversation(channel: str, member, lead, conversation_id: str | None):
    if conversation_id:  # chat web: continúa solo una conversación anónima de canal web
        c = _first(core.get("/api/conversations", id=conversation_id, channel="web"))
        if c and not c["memberId"] and not c["leadId"]:
            return c
    q = {"channel": channel, "limit": 1}
    if member:
        q["memberId"] = member["id"]
    elif lead:
        q["leadId"] = lead["id"]
    elif channel == "whatsapp":
        raise ValueError("Contacto de WhatsApp sin socio ni lead")
    else:
        q = None
    c = _first(core.get("/api/conversations", **q)) if q else None
    if c:
        return c
    body = {"channel": channel, **({"memberId": member["id"]} if member else {"leadId": lead["id"]} if lead else {})}
    status, c = core.call("POST", "/api/conversations", json=body)
    if status != 201:
        raise RuntimeError(f"No se pudo crear la conversación: {status} {c}")
    return c


def _today_user_messages(conv_id: str) -> int:
    start = datetime.now(tools.TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = core.get("/api/messages", conversationId=conv_id, role="user", limit=500)
    return sum(1 for r in rows if datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")) >= start)


def _save(conv_id: str, role: str, content: str):
    core.call("POST", "/api/messages", json={"conversationId": conv_id, "role": role, "content": content[:4000]})


def handle(text: str, channel: str, phone: str | None = None, conversation_id: str | None = None) -> tuple[str | None, str]:
    """Devuelve (respuesta o None si atiende una persona, id de conversación)."""
    text = text.strip()[: config.MAX_INPUT]
    member = lead = None
    if phone:  # solo WhatsApp: el número viene firmado por Meta
        variants = phone_variants(phone)
        member = _find_by_phone("/api/members", variants)
        if not member:
            lead = _find_by_phone("/api/leads", variants)
            if not lead:
                _, lead = core.call("POST", "/api/leads", json={"name": f"WhatsApp {variants[0]}", "phone": variants[0], "source": "whatsapp"})
    conv = _conversation(channel, member, lead, conversation_id)
    cid = conv["id"]
    if _today_user_messages(cid) >= config.DAILY_LIMIT:
        return LIMIT_MSG, cid
    history = [{"role": "user" if m["role"] == "user" else "assistant", "content": m["content"]}
               for m in reversed(core.get("/api/messages", conversationId=cid, limit=10))]
    _save(cid, "user", text)
    if conv.get("escalated"):
        return (HUMAN_MSG if channel == "web" else None), cid  # ya la atiende una persona
    reply = agent.run(Ctx(conversation_id=cid, member=member), history, text)
    _save(cid, "assistant", reply)
    return reply, cid


class Rejected(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


WINDOW_HOURS = 24  # WhatsApp solo permite texto libre dentro de las 24 h posteriores al último mensaje del cliente


def send_staff(conversation_id: str, text: str) -> bool:
    """El personal contesta por WhatsApp. Devuelve si salió de verdad (False = simulado, sin credenciales)."""
    conv = _first(core.get("/api/conversations", id=conversation_id))
    if not conv:
        raise Rejected(404, "Conversación no encontrada")
    if conv["channel"] != "whatsapp":
        raise Rejected(409, "Solo se puede responder por WhatsApp")
    who = (_first(core.get("/api/members", id=conv["memberId"])) if conv["memberId"]
           else _first(core.get("/api/leads", id=conv["leadId"])) if conv["leadId"] else None)
    if not who:
        raise Rejected(409, "La conversación no tiene un contacto con teléfono")
    last = _first(core.get("/api/messages", conversationId=conversation_id, role="user", limit=1))
    if not last or (datetime.now().astimezone() - datetime.fromisoformat(last["createdAt"].replace("Z", "+00:00"))).total_seconds() > WINDOW_HOURS * 3600:
        raise Rejected(409, "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas")
    sent = whatsapp.send(who["phone"], text)
    _save(conversation_id, "staff", text)
    return sent
