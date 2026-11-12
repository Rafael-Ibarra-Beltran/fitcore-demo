"""Herramientas del agente. El teléfono/socio sale del remitente (Ctx), nunca de los argumentos del modelo."""
import json
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from . import config, core, rag

TZ = ZoneInfo(config.GYM_TZ)


@dataclass
class Ctx:
    conversation_id: str
    member: dict | None = None  # solo se llena si el remitente está verificado (WhatsApp)
    notes: list = field(default_factory=list)


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


def _tool(name: str, desc: str, params: dict) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": params}}


TOOLS = [
    _tool("buscar_conocimiento", "Busca en reglamento, planes y precios, horarios y preguntas frecuentes del gimnasio.",
          _obj({"consulta": {"type": "string"}}, ["consulta"])),
    _tool("consultar_membresia", "Estado y vencimiento de la membresía de quien escribe.", _obj({})),
    _tool("listar_clases", "Clases próximas con cupo disponible. `dia` opcional en formato AAAA-MM-DD.",
          _obj({"dia": {"type": "string"}})),
    _tool("reservar_clase", "Reserva una clase para quien escribe. `clase_id` sale de listar_clases.",
          _obj({"clase_id": {"type": "string"}}, ["clase_id"])),
    _tool("consultar_ocupacion", "Cuánta gente hay ahora en el gimnasio, el aforo máximo y si está lleno.", _obj({})),
    _tool("escalar_a_humano", "Pasa la conversación al personal cuando no hay respuesta confiable o la persona lo pide.",
          _obj({"motivo": {"type": "string"}}, ["motivo"])),
]


def buscar_conocimiento(ctx: Ctx, consulta: str):
    return rag.search(consulta) or "Sin resultados en la base de conocimiento."


def consultar_membresia(ctx: Ctx):
    if not ctx.member:
        return "No hay un socio verificado asociado a este chat."
    rows = core.get("/api/memberships", memberId=ctx.member["id"], limit=50)
    if not rows:
        return "El socio no tiene membresías."
    m = max(rows, key=lambda r: r["endsAt"])  # la de vencimiento más lejano
    return {"estado": m["status"], "vence": m["endsAt"], "socio": ctx.member["name"]}


def listar_clases(ctx: Ctx, dia: str = ""):
    now = datetime.now(TZ)
    out = []
    for c in core.get("/api/classes", limit=500):
        start = datetime.fromisoformat(c["startsAt"].replace("Z", "+00:00")).astimezone(TZ)
        if start < now or (dia and start.date().isoformat() != dia):
            continue
        taken = len(core.get("/api/bookings", classId=c["id"], status="reservada", limit=500))
        out.append({"clase_id": c["id"], "nombre": c["name"], "instructor": c["instructor"],
                    "inicio": start.strftime("%Y-%m-%d %H:%M"), "cupo_libre": max(c["capacity"] - taken, 0)})
        if len(out) == 8:
            break
    return out or "No hay clases próximas con ese filtro."


def reservar_clase(ctx: Ctx, clase_id: str):
    if not ctx.member:
        return "Para reservar hay que ser socio verificado por WhatsApp."
    status, body = core.call("POST", "/api/bookings", json={"classId": clase_id, "memberId": ctx.member["id"]})
    if status == 201:
        return "Reserva creada."
    return f"No se pudo reservar: {body.get('error', status) if isinstance(body, dict) else status}"


def consultar_ocupacion(ctx: Ctx):
    d = core.get("/api/occupancy/now")
    if not d:
        return "Sin datos de aforo."
    if not d["fresh"]:  # la cámara pudo caerse: no presentar un conteo viejo como el de ahora
        return {"personas": d["people"], "al": d["at"], "nota": "Lectura de hace más de 15 minutos; puede no reflejar el momento actual."}
    return {"personas": d["people"], "al": d["at"], "aforo_maximo": d["max"], "lleno": d["over"]}


def escalar_a_humano(ctx: Ctx, motivo: str):
    core.call("PATCH", f"/api/conversations/{ctx.conversation_id}", json={"escalated": 1})
    ctx.notes.append(motivo)
    return "Conversación marcada para el personal."


FUNCS = {f.__name__: f for f in (buscar_conocimiento, consultar_membresia, listar_clases, reservar_clase,
                                 consultar_ocupacion, escalar_a_humano)}


def run(ctx: Ctx, name: str, args: str | dict) -> str:
    try:
        a = json.loads(args) if isinstance(args, str) else args
        res = FUNCS[name](ctx, **(a or {}))
    except Exception as e:  # el modelo recibe el fallo y puede explicarlo o escalar
        res = f"Error: {e}"
    return res if isinstance(res, str) else json.dumps(res, ensure_ascii=False, default=str)
