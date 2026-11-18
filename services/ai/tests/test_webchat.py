"""Chat web: token de invitado, SSE, límites persistentes y alcance."""
import json
import time
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app import agent, config, main, tools, webchat


def chunk(content=None, calls=None):
    return NS(choices=[NS(delta=NS(content=content, tool_calls=calls))])


def tool_chunk(name, args="{}"):
    return chunk(calls=[NS(index=0, id="t1", function=NS(name=name, arguments=args))])


def events(resp):
    out = []
    for block in resp.text.strip().split("\n\n"):
        ev, data = block.split("\n")
        out.append((ev.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return out


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setattr(config, "CHAT_TOKEN_SECRET", "test-secret-test-secret")


@pytest.fixture
def web(monkeypatch):
    """BD y núcleo simulados: una conversación web anónima, sin mensajes, que no está escalada."""
    saved = []
    monkeypatch.setattr(webchat.service, "_save", lambda cid, role, content: saved.append((role, content)))
    monkeypatch.setattr(webchat, "conversation", lambda cid: (False, 0))
    monkeypatch.setattr(webchat, "recent", lambda cid: [])
    monkeypatch.setattr(webchat, "web_messages_today", lambda: 0)
    monkeypatch.setattr(webchat, "guest_member", lambda: {"id": "M1", "name": "Invitado"})
    main._hits.clear()
    return saved


def post(token, text="hola"):
    h = {"authorization": f"Bearer {token}"} if token else {}
    return TestClient(main.app).post("/chat/stream", json={"message": text}, headers=h)


def test_token_roundtrip_and_tampering():
    t = webchat.sign("C1")
    assert webchat.verify(t) == "C1"
    body, sig = t.split(".")
    for bad in (None, "", "x.y", f"{body}.{sig[:-2]}ab", f"{webchat._b64(b'{}')}.{sig}"):
        with pytest.raises(webchat.Denied):
            webchat.verify(bad)


def test_expired_token_rejected(monkeypatch):
    t = webchat.sign("C1", ttl=-1)
    with pytest.raises(webchat.Denied):
        webchat.verify(t)


def test_stream_requires_token():
    assert post(None).status_code == 401
    assert post("basura").status_code == 401


def test_stream_event_order_with_tool_and_card(monkeypatch, web):
    steps = iter([[tool_chunk("consultar_ocupacion")], [chunk("Hay "), chunk("12 personas.")]])
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: iter(next(steps)))
    occ = {"fresh": True, "people": 12, "at": "x", "max": 40, "over": False}
    monkeypatch.setattr(tools.core, "get", lambda path, **q: occ if "occupancy" in path else [])
    r = post(webchat.sign("C1"), "¿cuánta gente hay?")
    assert r.headers["content-type"].startswith("text/event-stream")
    ev = events(r)
    assert [e for e, _ in ev] == ["tool", "card", "token", "token", "done"]
    assert ev[1][1] == {"kind": "ocupacion", "personas": 12, "aforo": 40, "lleno": False}
    assert web == [("user", "¿cuánta gente hay?"), ("assistant", "Hay 12 personas.")]


def test_off_topic_is_marked_and_never_escalates(monkeypatch, web):
    steps = iter([[tool_chunk("fuera_de_tema", '{"motivo": "código"}')], [chunk("Solo ayudo con el gimnasio.")]])
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: iter(next(steps)))
    monkeypatch.setattr(tools.core, "call", lambda *a, **k: pytest.fail("fuera de tema no debe escalar"))
    ev = events(post(webchat.sign("C1"), "escribe un script en python"))
    assert ("card", {"kind": "fuera_de_tema"}) in ev and ev[-1][0] == "done"
    assert web[-1] == ("assistant", webchat.MARK + "Solo ayudo con el gimnasio.")


def test_cooldown_after_repeated_off_topic(monkeypatch, web):
    monkeypatch.setattr(webchat, "recent", lambda cid: [("assistant", webchat.MARK + "no")] * config.OFF_TOPIC_MAX)
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: pytest.fail("no debe gastar LLM"))
    ev = events(post(webchat.sign("C1")))
    assert ev == [("error", {"message": webchat.COOLDOWN_MSG, "status": 429})]


def test_off_topic_streak_counts_only_trailing_refusals():
    rows = [("assistant", webchat.MARK + "a"), ("user", "x"), ("assistant", webchat.MARK + "b"), ("assistant", "ok")]  # más nuevos primero
    assert webchat.off_topic_streak(rows) == 2


def test_global_and_conversation_limits_block_before_llm(monkeypatch, web):
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: pytest.fail("no debe gastar LLM"))
    monkeypatch.setattr(webchat, "web_messages_today", lambda: config.GLOBAL_DAILY_LIMIT)
    assert events(post(webchat.sign("C1")))[0][1]["message"] == webchat.BUSY_MSG
    monkeypatch.setattr(webchat, "web_messages_today", lambda: 0)
    monkeypatch.setattr(webchat, "conversation", lambda cid: (False, config.DAILY_LIMIT))
    assert events(post(webchat.sign("C1")))[0][1]["message"] == webchat.LIMIT_MSG


def test_escalated_conversation_returns_handoff_card_without_llm(monkeypatch, web):
    monkeypatch.setattr(webchat, "conversation", lambda cid: (True, 0))
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: pytest.fail("no debe gastar LLM"))
    assert [e for e, _ in events(post(webchat.sign("C1")))] == ["card", "done"]


def test_midstream_failure_ends_in_error_event(monkeypatch, web):
    def boom(m, t):
        yield chunk("Hola ")
        raise RuntimeError("se cayó el proveedor")
    monkeypatch.setattr(agent.llm, "stream", boom)
    ev = events(post(webchat.sign("C1")))
    assert [e for e, _ in ev] == ["token", "error"]


def test_cors_allows_authorization_header():
    r = TestClient(main.app).options("/chat/stream", headers={
        "origin": config.ORIGINS[0], "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type"})
    assert r.status_code == 200 and "authorization" in r.headers["access-control-allow-headers"].lower()


def test_client_abort_still_saves_what_was_answered(monkeypatch, web):
    """Detener la respuesta no deja el hilo sin cierre ni pierde la marca de fuera de tema."""
    steps = iter([[tool_chunk("fuera_de_tema", '{"motivo": "receta"}')], [chunk("Solo ayudo con "), chunk("el gimnasio.")]])
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: iter(next(steps)))
    gen = webchat.stream("C1", "dame una receta")
    next(gen), next(gen)  # evento tool y primer token
    gen.close()  # el cliente corta aquí
    assert web[0] == ("user", "dame una receta")
    assert web[1] == ("assistant", webchat.MARK + "Solo ayudo con ")


def test_partial_text_is_saved_when_client_aborts_mid_answer(monkeypatch, web):
    monkeypatch.setattr(agent.llm, "stream", lambda m, t: iter([chunk("Hola "), chunk("a todos")]))
    gen = webchat.stream("C1", "hola")
    next(gen)
    gen.close()
    assert web[-1] == ("assistant", "Hola ")


def test_chat_web_is_off_without_secret(monkeypatch):
    monkeypatch.setattr(config, "CHAT_TOKEN_SECRET", "")
    assert post("cualquier.cosa").status_code == 503


def test_ip_uses_entry_added_by_our_proxy_and_ignores_client_spoofing(monkeypatch):
    from starlette.requests import Request
    def req(h):
        return Request({"type": "http", "headers": [(k.encode(), v.encode()) for k, v in h.items()], "client": ("10.0.0.1", 1)})
    assert main.client_ip(req({"x-forwarded-for": "9.9.9.9, 1.2.3.4"})) == "1.2.3.4"  # 9.9.9.9 lo puso el cliente
    assert main.client_ip(req({"cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "9.9.9.9"})) == "5.5.5.5"
    assert main.client_ip(req({})) == "10.0.0.1"


def test_ip_table_is_pruned(monkeypatch):
    main._hits.clear()
    for i in range(5001):
        main._hits[f"ip{i}"] = [time.monotonic() - 120]  # viejas: ya no cuentan
    main.limit_ip("nueva")
    assert len(main._hits) == 1


def test_card_mapping_for_every_tool():
    out = lambda n, o: agent._card(n, json.dumps(o) if not isinstance(o, str) else o)
    assert out("consultar_membresia", {"estado": "activa", "vence": "2027-01-01", "socio": "Ana"}) == {"kind": "membresia", "socio": "Ana", "estado": "activa", "vence": "2027-01-01"}
    assert out("reservar_clase", "Reserva creada.") == {"kind": "reserva", "ok": True, "mensaje": "Reserva creada."}
    assert out("reservar_clase", "No se pudo reservar: Ya tiene reserva")["ok"] is False
    assert out("escalar_a_humano", "Conversación marcada para el personal.") == {"kind": "escalado"}
    assert out("listar_clases", "No hay clases próximas con ese filtro.") is None
    assert out("buscar_conocimiento", "texto") is None


def test_stream_falls_back_to_second_model_only_before_first_chunk(monkeypatch):
    from app import llm
    monkeypatch.setattr(config, "LLM_MODEL", "principal")
    monkeypatch.setattr(config, "LLM_FALLBACK_MODEL", "respaldo")
    seen = []

    def fake(model, **kw):
        seen.append(model)
        assert "fallbacks" not in kw  # roto con stream=True en LiteLLM
        if model == "principal":
            raise RuntimeError("503 del proveedor")
        return iter([chunk("ok")])
    monkeypatch.setattr(llm.litellm, "completion", fake)
    assert [c.choices[0].delta.content for c in llm.stream([], [])] == ["ok"]
    assert seen == ["principal", "respaldo"]

    def mid(model, **kw):
        def gen():
            yield chunk("a")
            raise RuntimeError("se cortó")
        return gen()
    monkeypatch.setattr(llm.litellm, "completion", mid)
    g = llm.stream([], [])
    next(g)
    with pytest.raises(RuntimeError):
        next(g)  # ya empezó: no se cambia de modelo a media respuesta
