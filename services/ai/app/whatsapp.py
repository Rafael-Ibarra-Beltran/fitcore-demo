import hashlib
import hmac
import logging
from collections import OrderedDict

import httpx

from . import config

log = logging.getLogger("whatsapp")

# shortcut: ids vistos en memoria (Meta reintenta si tarda); se pierden al reiniciar, usar una tabla si importa.
_seen: OrderedDict[str, None] = OrderedDict()


def fresh(msg_id: str) -> bool:
    """True la primera vez que se ve un id de mensaje."""
    if msg_id in _seen:
        return False
    _seen[msg_id] = None
    while len(_seen) > 2000:
        _seen.popitem(last=False)
    return True


def valid_signature(body: bytes, header: str | None) -> bool:
    if config.WA_SKIP_SIGNATURE:
        return True
    if not config.WA_APP_SECRET or not header:
        return False
    expected = "sha256=" + hmac.new(config.WA_APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def incoming(payload: dict) -> list[tuple[str, str, str]]:
    """(id, teléfono, texto) de cada mensaje de texto del payload de Meta."""
    out = []
    for entry in payload.get("entry", []):
        for ch in entry.get("changes", []):
            for m in ch.get("value", {}).get("messages", []):
                if m.get("type") == "text":
                    out.append((m.get("id", ""), m["from"], m["text"]["body"]))
    return out


def _post(payload: dict) -> bool:
    """True si salió por WhatsApp, False si solo se simuló (sin credenciales). Lanza si la API rechaza el envío."""
    if not (config.WA_TOKEN and config.WA_PHONE_ID):
        log.info("WhatsApp sin credenciales; mensaje simulado para %s: %s", payload["to"], payload.get("text") or payload.get("template"))
        return False
    # Meta entrega los móviles de México como 521… pero la lista de destinatarios y el envío usan 52…
    to = payload["to"]
    if to.startswith("521") and len(to) == 13:
        payload = {**payload, "to": "52" + to[3:]}
    r = httpx.post(
        f"https://graph.facebook.com/{config.WA_API_VERSION}/{config.WA_PHONE_ID}/messages",
        headers={"Authorization": f"Bearer {config.WA_TOKEN}"},
        json={"messaging_product": "whatsapp", **payload},
        timeout=10,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"WhatsApp {r.status_code}: {r.text[:200]}")
    return True


def send(to: str, text: str) -> bool:
    """Texto libre: solo dentro de las 24 h posteriores al último mensaje del cliente."""
    return _post({"to": to.lstrip("+"), "type": "text", "text": {"body": text}})


def send_template(to: str, name: str, params: list[str]) -> bool:
    """Plantilla aprobada: la única forma de escribir primero o fuera de la ventana de 24 h."""
    # Meta rechaza saltos de línea y tabuladores dentro de un parámetro de plantilla.
    clean = [" ".join(p.split()) for p in params]
    template: dict = {"name": name, "language": {"code": config.WA_TEMPLATE_LANG}}
    if clean:
        template["components"] = [{"type": "body", "parameters": [{"type": "text", "text": p} for p in clean]}]
    return _post({"to": to.lstrip("+"), "type": "template", "template": template})
