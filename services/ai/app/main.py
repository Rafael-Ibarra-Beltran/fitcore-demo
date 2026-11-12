import hmac
import json
import logging
import time
from collections import defaultdict

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

from . import config, rag, service, whatsapp

log = logging.getLogger("ai")
app = FastAPI(title="FitCore AI")
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGINS, allow_methods=["POST"], allow_headers=["content-type"])

_hits: dict[str, list[float]] = defaultdict(list)


def limit_ip(ip: str, n: int = 10, window: float = 60) -> None:
    # shortcut: en memoria y por instancia; pasar a Redis/DB si hay varias instancias.
    now = time.monotonic()
    _hits[ip] = [t for t in _hits[ip] if now - t < window]
    if len(_hits[ip]) >= n:
        raise HTTPException(429, "Demasiadas solicitudes")
    _hits[ip].append(now)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/privacidad", response_class=HTMLResponse)
def privacidad():
    # Meta exige una URL pública de política de privacidad para publicar la app de la demo.
    return (
        '<!doctype html><meta charset="utf-8"><title>Privacidad · FitCore Demo</title>'
        "<h1>Política de privacidad · FitCore Demo</h1>"
        "<p>FitCore es una demostración de Quirelia Studio con datos ficticios. Los mensajes que se envían "
        "al asistente se procesan con un modelo de lenguaje (Gemini) solo para responderlos y se guardan "
        "en la base de la demo. No se venden ni se comparten con terceros.</p>"
        "<p>Para pedir que se borren tus mensajes, contacta a Quirelia Studio.</p>"
    )


@app.get("/webhook", response_class=PlainTextResponse)
def verify(mode: str = Query("", alias="hub.mode"), token: str = Query("", alias="hub.verify_token"),
           challenge: str = Query("", alias="hub.challenge")):
    if mode == "subscribe" and config.WA_VERIFY_TOKEN and token == config.WA_VERIFY_TOKEN:
        return challenge
    raise HTTPException(403, "Token inválido")


def reply_whatsapp(phone: str, text: str) -> None:
    try:
        reply, _ = service.handle(text, "whatsapp", phone=phone)
        if reply:
            whatsapp.send(phone, reply)
    except Exception:
        log.exception("Fallo al procesar mensaje de WhatsApp")


@app.post("/webhook")
async def webhook(req: Request, bg: BackgroundTasks):
    body = await req.body()
    if not whatsapp.valid_signature(body, req.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "Firma inválida")
    for msg_id, phone, text in whatsapp.incoming(json.loads(body or b"{}")):
        if not msg_id or whatsapp.fresh(msg_id):  # Meta reintenta: no contestar dos veces el mismo mensaje
            bg.add_task(reply_whatsapp, phone, text)
    return {"ok": True}  # Meta reintenta si no hay 200 inmediato


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=config.MAX_INPUT)
    conversation_id: str | None = None


@app.post("/chat")
def chat(body: ChatIn, req: Request):
    """Chat web: anónimo, sin herramientas personales (el teléfono no está verificado)."""
    limit_ip(req.client.host if req.client else "?")
    reply, cid = service.handle(body.message, "web", conversation_id=body.conversation_id)
    return {"reply": reply, "conversation_id": cid}


def service_key(x_service_key: str | None = Header(None)) -> None:
    if not x_service_key or not hmac.compare_digest(x_service_key, config.SERVICE_KEY):
        raise HTTPException(401, "Clave de servicio inválida")


class SendIn(BaseModel):
    conversation_id: str
    text: str = Field(min_length=1, max_length=1000)


@app.post("/send", dependencies=[Depends(service_key)])
def send(body: SendIn):
    """Respuesta del personal desde el panel (la llama el núcleo con la clave de servicio)."""
    try:
        return {"ok": True, "sent": service.send_staff(body.conversation_id, body.text)}
    except service.Rejected as e:
        raise HTTPException(e.status, str(e))
    except RuntimeError as e:  # WhatsApp rechazó el envío
        raise HTTPException(502, str(e))


@app.post("/ingest", dependencies=[Depends(service_key)])
def ingest():
    """Regenera los embeddings del RAG tras editar documentos en el panel."""
    return {"chunks": rag.ingest()}


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    params: list[str] = []


class NotifyIn(BaseModel):
    to: str = Field(min_length=8, max_length=20)
    text: str = Field(min_length=1, max_length=1000)
    template: TemplateIn | None = None


@app.post("/notify", dependencies=[Depends(service_key)])
def notify(body: NotifyIn):
    """Mensaje proactivo de una automatización (lo llama el núcleo). Con plantilla si la hay; si no, texto libre."""
    try:
        sent = (whatsapp.send_template(body.to, body.template.name, body.template.params)
                if body.template else whatsapp.send(body.to, body.text))
        return {"ok": True, "sent": sent}
    except RuntimeError as e:
        raise HTTPException(502, str(e))
