import hashlib
import hmac
import json
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app import agent, config, main, rag, service, tools, whatsapp
from app.tools import Ctx


def msg(content=None, calls=None):
    return NS(choices=[NS(message=NS(content=content, tool_calls=calls))])


def call(name, args, id="1"):
    return NS(id=id, function=NS(name=name, arguments=json.dumps(args)))


def test_phone_variants_cover_both_mx_mobile_forms():
    assert service.phone_variants("5215512345678") == ["+5215512345678", "+525512345678"]
    assert service.phone_variants("+525512345678") == ["+525512345678", "+5215512345678"]
    assert service.phone_variants("14155550100") == ["+14155550100"]


def test_member_found_under_either_phone_form(monkeypatch):
    # La BD guarda +521..., Meta puede mandar 52...: debe reconocerse al socio, no crear un lead.
    stored = {"+5215512345678": {"id": "M1", "name": "Ana"}}
    monkeypatch.setattr(service.core, "get", lambda path, **q: [stored[q["phone"]]] if q.get("phone") in stored else [])
    assert service._find_by_phone("/api/members", service.phone_variants("525512345678"))["id"] == "M1"
    assert service._find_by_phone("/api/members", service.phone_variants("5215512345678"))["id"] == "M1"
    assert service._find_by_phone("/api/members", service.phone_variants("5599999999")) is None


def test_chunks_respect_size():
    text = "\n\n".join(["a" * 300, "b" * 300, "c" * 1500])
    parts = rag.chunks(text, 600)
    assert all(len(p) <= 600 for p in parts) and "".join(parts).count("c") == 1500


def test_tool_schemas_never_take_phone_or_member():
    for t in tools.TOOLS:
        props = t["function"]["parameters"]["properties"]
        assert not {"telefono", "phone", "member_id", "socio"} & set(props)


def test_personal_tools_refuse_without_verified_member(monkeypatch):
    monkeypatch.setattr(tools.core, "call", lambda *a, **k: pytest.fail("no debe llamar al core"))
    ctx = Ctx(conversation_id="c1")
    assert "verificado" in tools.run(ctx, "reservar_clase", {"clase_id": "x"})
    assert "verificado" in tools.run(ctx, "consultar_membresia", {})


def test_booking_uses_sender_member_and_rejects_model_supplied_member(monkeypatch):
    seen = []
    monkeypatch.setattr(tools.core, "call", lambda m, p, **k: seen.append(k["json"]) or (201, {}))
    ctx = Ctx("c1", member={"id": "M1", "name": "Ana"})
    tools.run(ctx, "reservar_clase", {"clase_id": "K1"})
    assert seen == [{"classId": "K1", "memberId": "M1"}]
    seen.clear()
    assert tools.run(ctx, "reservar_clase", {"clase_id": "K1", "memberId": "OTRO"}).startswith("Error")
    assert seen == []


def test_agent_runs_tool_then_answers(monkeypatch):
    replies = iter([msg(calls=[call("buscar_conocimiento", {"consulta": "precio"})]), msg("Mensual $599")])
    monkeypatch.setattr(agent.llm, "chat", lambda m, t: next(replies))
    monkeypatch.setattr(tools.rag, "search", lambda q: ["Mensual $599"])
    assert agent.run(Ctx("c1"), [], "¿cuánto cuesta?") == "Mensual $599"


def test_agent_loop_is_capped_and_escalates(monkeypatch):
    monkeypatch.setattr(agent.llm, "chat", lambda m, t: msg(calls=[call("consultar_ocupacion", {})]))
    escalated = []
    monkeypatch.setattr(tools.core, "get", lambda *a, **k: [])
    monkeypatch.setattr(tools.core, "call", lambda m, p, **k: escalated.append(p) or (200, {}))
    assert agent.run(Ctx("c1"), [], "hola") == agent.FALLBACK
    assert any(p.endswith("/c1") for p in escalated)


def test_unknown_tool_error_goes_back_to_model():
    assert tools.run(Ctx("c1"), "borrar_todo", {}).startswith("Error")


def sign(body: bytes, secret="s3"):
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_webhook_signature_and_background(monkeypatch):
    monkeypatch.setattr(config, "WA_APP_SECRET", "s3")
    monkeypatch.setattr(config, "WA_SKIP_SIGNATURE", False)
    got = []
    monkeypatch.setattr(main.service, "handle", lambda t, ch, phone=None, **k: got.append((t, ch, phone)) or ("ok", "c"))
    monkeypatch.setattr(main.whatsapp, "send", lambda to, t: got.append(("sent", to, t)))
    body = json.dumps({"entry": [{"changes": [{"value": {"messages": [
        {"id": "wamid.1", "from": "5215512345678", "type": "text", "text": {"body": "hola"}},
        {"from": "5215512345678", "type": "image"}]}}]}]}).encode()
    c = TestClient(main.app)
    assert c.post("/webhook", content=body).status_code == 401
    assert c.post("/webhook", content=body, headers={"x-hub-signature-256": "sha256=mala"}).status_code == 401
    whatsapp._seen.clear()
    ok = {"x-hub-signature-256": sign(body)}
    assert c.post("/webhook", content=body, headers=ok).status_code == 200
    assert got == [("hola", "whatsapp", "5215512345678"), ("sent", "5215512345678", "ok")]
    got.clear()
    assert c.post("/webhook", content=body, headers=ok).status_code == 200  # reintento de Meta: mismo id
    assert got == []


def test_webhook_verify_handshake(monkeypatch):
    monkeypatch.setattr(config, "WA_VERIFY_TOKEN", "tok")
    c = TestClient(main.app)
    ok = c.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "42"})
    assert ok.text == "42"
    assert c.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42"}).status_code == 403


def test_chat_rate_limit_per_ip(monkeypatch):
    monkeypatch.setattr(main.service, "handle", lambda *a, **k: ("hola", "c1"))
    main._hits.clear()
    c = TestClient(main.app)
    codes = [c.post("/chat", json={"message": "hola"}).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_send_requires_service_key():
    c = TestClient(main.app)
    assert c.post("/send", json={"conversation_id": "x", "text": "hola"}).status_code == 401
    assert c.post("/send", json={"conversation_id": "x", "text": "hola"}, headers={"x-service-key": "mala"}).status_code == 401
    assert c.post("/ingest").status_code == 401


def _fake_core(monkeypatch, channel="whatsapp", last_msg_age_h=1.0, member=True):
    from datetime import datetime, timedelta, timezone
    last = (datetime.now(timezone.utc) - timedelta(hours=last_msg_age_h)).isoformat().replace("+00:00", "Z")
    data = {
        "/api/conversations": [{"id": "c1", "channel": channel, "memberId": "M1" if member else None, "leadId": None}],
        "/api/members": [{"id": "M1", "phone": "+525512345678"}],
        "/api/messages": [{"createdAt": last}],
    }
    monkeypatch.setattr(service.core, "get", lambda path, **q: data[path])
    saved = []
    monkeypatch.setattr(service.core, "call", lambda m, p, **k: saved.append(k["json"]) or (201, {}))
    sent = []
    monkeypatch.setattr(service.whatsapp, "send", lambda to, t: sent.append((to, t)) or True)
    return saved, sent


KEY = {"x-service-key": config.SERVICE_KEY}


def test_send_inside_window_sends_and_saves_as_staff(monkeypatch):
    saved, sent = _fake_core(monkeypatch)
    r = TestClient(main.app).post("/send", json={"conversation_id": "c1", "text": "Hola, te ayudo"}, headers=KEY)
    assert r.status_code == 200 and r.json() == {"ok": True, "sent": True}
    assert sent == [("+525512345678", "Hola, te ayudo")]
    assert saved == [{"conversationId": "c1", "role": "staff", "content": "Hola, te ayudo"}]


def test_send_outside_24h_window_is_rejected_and_not_sent(monkeypatch):
    saved, sent = _fake_core(monkeypatch, last_msg_age_h=25)
    r = TestClient(main.app).post("/send", json={"conversation_id": "c1", "text": "hola"}, headers=KEY)
    assert r.status_code == 409 and "24 horas" in r.json()["detail"]
    assert sent == [] and saved == []


def test_send_rejects_web_channel(monkeypatch):
    _, sent = _fake_core(monkeypatch, channel="web", member=False)
    r = TestClient(main.app).post("/send", json={"conversation_id": "c1", "text": "hola"}, headers=KEY)
    assert r.status_code == 409 and sent == []


def test_send_maps_whatsapp_api_failure_to_502(monkeypatch):
    _fake_core(monkeypatch)
    def boom(to, t): raise RuntimeError("WhatsApp 401")
    monkeypatch.setattr(service.whatsapp, "send", boom)
    assert TestClient(main.app).post("/send", json={"conversation_id": "c1", "text": "hola"}, headers=KEY).status_code == 502


def test_notify_requires_key_and_simulates_without_credentials(monkeypatch):
    monkeypatch.setattr(config, "WA_TOKEN", "")
    c = TestClient(main.app)
    body = {"to": "+525512345678", "text": "Hola", "template": {"name": "fitcore_vencimiento", "params": ["Ana", "2026-12-01"]}}
    assert c.post("/notify", json=body).status_code == 401
    assert c.post("/notify", json=body, headers=KEY).json() == {"ok": True, "sent": False}


def test_template_payload_shape_and_param_cleanup(monkeypatch):
    sent = []
    monkeypatch.setattr(whatsapp, "_post", lambda payload: sent.append(payload) or True)
    whatsapp.send_template("+525512345678", "fitcore_vencimiento", ["Ana\nPérez", "2026-12-01"])
    p = sent[0]
    assert p["to"] == "525512345678" and p["type"] == "template"
    assert p["template"]["name"] == "fitcore_vencimiento" and p["template"]["language"] == {"code": "es_MX"}
    assert p["template"]["components"][0]["parameters"] == [{"type": "text", "text": "Ana Pérez"}, {"type": "text", "text": "2026-12-01"}]
    whatsapp.send_template("+525512345678", "sin_params", [])
    assert "components" not in sent[1]["template"]


def test_notify_maps_whatsapp_failure_to_502(monkeypatch):
    def boom(*a, **k): raise RuntimeError("WhatsApp 400")
    monkeypatch.setattr(whatsapp, "send", boom)
    r = TestClient(main.app).post("/notify", json={"to": "+525512345678", "text": "hola"}, headers=KEY)
    assert r.status_code == 502


def test_ocupacion_distingue_lectura_reciente_de_vieja(monkeypatch):
    base = {"people": 30, "at": "2026-11-10T20:00:00Z", "max": 40, "over": False}
    monkeypatch.setattr(tools.core, "get", lambda path, **q: {**base, "fresh": True} if path == "/api/occupancy/now" else pytest.fail(path))
    r = json.loads(tools.run(Ctx("c1"), "consultar_ocupacion", {}))
    assert r == {"personas": 30, "al": base["at"], "aforo_maximo": 40, "lleno": False}
    monkeypatch.setattr(tools.core, "get", lambda path, **q: {**base, "fresh": False})
    old = json.loads(tools.run(Ctx("c1"), "consultar_ocupacion", {}))
    assert "lleno" not in old and "15 minutos" in old["nota"]
    monkeypatch.setattr(tools.core, "get", lambda path, **q: None)
    assert tools.run(Ctx("c1"), "consultar_ocupacion", {}) == "Sin datos de aforo."


def test_send_normaliza_movil_mexico_521_a_52(monkeypatch):
    monkeypatch.setattr(config, "WA_TOKEN", "t")
    monkeypatch.setattr(config, "WA_PHONE_ID", "1")
    sent = []
    monkeypatch.setattr(whatsapp.httpx, "post", lambda url, **kw: sent.append(kw["json"]["to"]) or NS(status_code=200))
    whatsapp.send("5216644855228", "hola")
    whatsapp.send("+14155550100", "hola")
    assert sent == ["526644855228", "14155550100"]
