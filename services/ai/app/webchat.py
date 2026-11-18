"""Chat web de la demo: token de invitado, límites persistentes y flujo SSE del agente."""
import base64
import hmac
import json
import logging
import time
from datetime import datetime
from hashlib import sha256

from . import agent, config, core, db, service, tools
from .tools import Ctx

log = logging.getLogger("ai.webchat")
MARK = "⁣"  # marca invisible en mensajes del asistente que fueron rechazos fuera de tema; así el conteo sobrevive reinicios
BUSY_MSG = "La demo alcanzó su límite diario de mensajes. Vuelve mañana o escríbenos por WhatsApp."
COOLDOWN_MSG = "Solo puedo ayudarte con temas del gimnasio, así que cierro esta conversación. Inicia una nueva si necesitas algo de clases, planes o aforo."


LIMIT_MSG = service.LIMIT_MSG


class Denied(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(cid: str, ttl: int = 7200) -> str:
    body = _b64(json.dumps({"c": cid, "e": int(time.time()) + ttl}).encode())
    return f"{body}.{_b64(hmac.new(config.CHAT_TOKEN_SECRET.encode(), body.encode(), sha256).digest())}"


def verify(token: str | None) -> str:
    """Devuelve el conversation_id del token o lanza Denied(401). Sin CHAT_TOKEN_SECRET el chat web está apagado (503)."""
    if not config.CHAT_TOKEN_SECRET:
        raise Denied(503, "Chat web no configurado")
    try:
        body, sig = (token or "").split(".")
        good = _b64(hmac.new(config.CHAT_TOKEN_SECRET.encode(), body.encode(), sha256).digest())
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if hmac.compare_digest(sig, good) and data["e"] > time.time():
            return data["c"]
    except (ValueError, KeyError, TypeError):
        pass
    raise Denied(401, "Sesión inválida o vencida")


def _start_of_day() -> datetime:
    return datetime.now(tools.TZ).replace(hour=0, minute=0, second=0, microsecond=0)


_global: list = [0.0, 0]  # [momento de la lectura, mensajes web de hoy]; se refresca cada 30 s para no ir a la BD en cada mensaje


def web_messages_today() -> int:
    """Mensajes de usuario del canal web hoy, en total. Va a la BD (no a memoria) porque Render reinicia el servicio."""
    if time.monotonic() - _global[0] > 30:
        rows = db.query(
            "select count(*) from message m join conversation c on c.id = m.conversation_id "
            "where c.organization_id = %s and c.channel = 'web' and m.role = 'user' and m.created_at >= %s",
            (db.org_id(), _start_of_day()))
        _global[:] = [time.monotonic(), rows[0][0]]
    return _global[1]


_demo_member: dict | None = None


def guest_member() -> dict | None:
    global _demo_member
    if _demo_member is None:
        rows = core.get("/api/members", phone=config.DEMO_MEMBER_PHONE, limit=1)
        _demo_member = rows[0] if rows else None
    return _demo_member


def conversation(cid: str) -> tuple[bool, int] | None:
    """(escalada, mensajes de usuario de hoy) de una conversación web, o None si no existe. Una sola consulta."""
    rows = db.query(
        "select c.escalated <> 0, (select count(*) from message m where m.conversation_id = c.id and m.role = 'user' and m.created_at >= %s) "
        "from conversation c where c.id = %s and c.channel = 'web' and c.organization_id = %s",
        (_start_of_day(), cid, db.org_id()))
    return (rows[0][0], rows[0][1]) if rows else None


def recent(cid: str) -> list[tuple[str, str]]:
    """Últimos 10 mensajes (rol, texto), del más nuevo al más viejo. Sirven de historial y para contar los rechazos."""
    return db.query("select role, content from message where conversation_id = %s order by created_at desc limit 10", (cid,))


def off_topic_streak(rows: list[tuple[str, str]]) -> int:
    """Rechazos fuera de tema seguidos al final del hilo."""
    n = 0
    for role, content in (r for r in rows if r[0] == "assistant"):
        if not content.startswith(MARK):
            break
        n += 1
    return n


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def check(cid: str) -> bool:
    """Valida la conversación y los límites antes de gastar LLM. Devuelve si ya la atiende una persona."""
    conv = conversation(cid)
    if not conv:
        raise Denied(404, "Conversación no encontrada")
    escalated, today = conv
    if today >= config.DAILY_LIMIT:
        raise Denied(429, LIMIT_MSG)
    if web_messages_today() >= config.GLOBAL_DAILY_LIMIT:
        raise Denied(429, BUSY_MSG)
    return escalated


def stream(cid: str, text: str):
    """Generador SSE. Un fallo a mitad del stream termina en evento `error` (los reintentos del LLM no aplican con el stream iniciado).
    Si el cliente corta (Detener, cerrar la pestaña), el `finally` guarda lo que alcanzó a responder para no dejar el hilo cojo."""
    text = text.strip()[: config.MAX_INPUT]
    try:
        escalated = check(cid)
    except Denied as e:
        yield _sse("error", {"message": str(e), "status": e.status})
        return
    ctx, saved_user, partial, final = Ctx(conversation_id=cid), False, "", None
    try:
        if escalated:
            service._save(cid, "user", text)
            yield _sse("card", {"kind": "escalado"})
            yield _sse("done", {"conversationId": cid, "escalated": True})
            return
        rows = recent(cid)
        if off_topic_streak(rows) >= config.OFF_TOPIC_MAX:
            yield _sse("error", {"message": COOLDOWN_MSG, "status": 429})
            return
        history = [{"role": "user" if role == "user" else "assistant", "content": content.lstrip(MARK)} for role, content in reversed(rows)]
        service._save(cid, "user", text)
        saved_user = True
        _global[1] += 1
        ctx.member = guest_member()
        for kind, val in agent.run_stream(ctx, history, text):
            if kind == "final":
                final = val
            elif kind == "token":
                partial += val
                yield _sse("token", {"text": val})
            else:
                yield _sse(kind, {"name": val} if kind == "tool" else val)
        if ctx.off_topic:
            yield _sse("card", {"kind": "fuera_de_tema"})
        yield _sse("done", {"conversationId": cid, "escalated": bool(ctx.notes)})
    except Exception:
        log.exception("Fallo en el stream del chat web")
        yield _sse("error", {"message": "Tuve un problema para responderte. Intenta de nuevo.", "status": 500})
    finally:
        if saved_user:
            service._save(cid, "assistant", (MARK if ctx.off_topic else "") + (final or partial or "(respuesta interrumpida)"))
