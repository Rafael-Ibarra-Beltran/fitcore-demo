"""Ejecuta evals/preguntas.yaml contra el agente real (necesita core, Postgres sembrado, RAG cargado y GEMINI_API_KEY)."""
import logging
import re
import sys
import time
from pathlib import Path

import yaml

logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # ruido de las tareas internas de LiteLLM
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import core, db, service  # noqa: E402

PAUSE = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0  # s entre preguntas: el plan gratuito da 15 peticiones/min por modelo y cada pregunta usa 2-4


def members():
    rows = db.query("select name, phone from gym_member where organization_id = %s and status = 'activo' order by joined_at limit 2", (db.org_id(),))
    if len(rows) < 2:
        sys.exit("Faltan al menos 2 socios activos sembrados")
    return rows


def reset_conversation(phone: str) -> None:
    """Cada caso parte de cero: el socio de prueba reutiliza su conversación, y su historial (y un escalado previo)
    contaminaría las respuestas de los casos siguientes."""
    for m in core.get("/api/members", phone=phone):
        for c in core.get("/api/conversations", memberId=m["id"]):
            core.call("DELETE", f"/api/conversations/{c['id']}")


def main() -> int:
    (a_name, a_phone), (b_name, b_phone) = members()
    cases = yaml.safe_load((Path(__file__).parent / "preguntas.yaml").read_text())
    fails = 0
    for c in cases:
        fill = lambda s: s.replace("{B_name}", b_name).replace("{B_phone}", b_phone)  # noqa: E731
        fill_re = lambda s: s.replace("{B_name}", re.escape(b_name)).replace("{B_phone}", re.escape(b_phone))  # noqa: E731
        phone = a_phone if c["canal"] == "socioA" else None
        if phone:
            reset_conversation(phone)
        try:
            reply, cid = service.handle(fill(c["pregunta"]), "whatsapp" if phone else "web", phone=phone)
        except Exception as e:  # un fallo del proveedor cuenta como pregunta fallida, no aborta la corrida
            fails += 1
            print("FALLA", c["id"], f"excepción: {str(e).splitlines()[0][:140]}")
            time.sleep(PAUSE)
            continue
        reply = reply or ""
        errors = [f"falta /{p}/" for p in c.get("espera", []) if not re.search(fill_re(p), reply, re.I)]
        errors += [f"sobra /{p}/" for p in c.get("no_espera", []) if re.search(fill_re(p), reply, re.I)]
        if c.get("escala") and not core.get("/api/conversations", id=cid)[0]["escalated"]:
            errors.append("no escaló")
        fails += bool(errors)
        print(("FALLA" if errors else "ok   "), c["id"], "; ".join(errors), "" if not errors else f"\n      → {reply[:160]!r}")
        time.sleep(PAUSE)
    print(f"\n{len(cases) - fails}/{len(cases)} correctas")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
