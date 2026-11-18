import os

e = os.environ.get


def flag(k: str) -> bool:
    return e(k) == "1"


DATABASE_URL = e("DATABASE_URL", "postgres://fitcore:fitcore@localhost:5432/fitcore")
CORE_URL = e("CORE_URL", "http://localhost:3000").rstrip("/")
SERVICE_KEY = e("SERVICE_KEY", "dev-service-key")
ORG_SLUG = e("SERVICE_ORG_SLUG", "fitcore-demo")
LLM_MODEL = e("LLM_MODEL", "gemini/gemini-3.5-flash-lite")
LLM_FALLBACK_MODEL = e("LLM_FALLBACK_MODEL") or None
EMBED_MODEL = e("EMBED_MODEL", "gemini/gemini-embedding-2")
EMBED_DIM = 768  # debe coincidir con kb_chunk.embedding vector(768)
DAILY_LIMIT = int(e("DAILY_LIMIT", "30"))
RAG_MIN_SCORE = float(e("RAG_MIN_SCORE", "0.3"))
GYM_TZ = e("GYM_TZ", "America/Mexico_City")
ORIGINS = e("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4321").split(",")
WA_VERIFY_TOKEN = e("WA_VERIFY_TOKEN", "")
WA_APP_SECRET = e("WA_APP_SECRET", "")
WA_TOKEN = e("WA_TOKEN", "")
WA_TEMPLATE_LANG = e("WA_TEMPLATE_LANG", "es_MX")
WA_API_VERSION = e("WA_API_VERSION", "v25.0")  # v21.0 termina su vida en 2027-01-21
WA_PHONE_ID = e("WA_PHONE_ID", "")
WA_SKIP_SIGNATURE = flag("WA_SKIP_SIGNATURE")
# Chat web de la demo
CHAT_TOKEN_SECRET = e("CHAT_TOKEN_SECRET", "")  # compartido con el núcleo, que emite los tokens. Sin valor por defecto: vacío = chat web apagado (503)
DEMO_MEMBER_PHONE = e("DEMO_MEMBER_PHONE", "+525500000000")  # socio sembrado al que se asocia el invitado
GLOBAL_DAILY_LIMIT = int(e("GLOBAL_DAILY_LIMIT", "400"))  # mensajes web por día en total: protege la cuota del LLM
OFF_TOPIC_MAX = int(e("OFF_TOPIC_MAX", "3"))  # rechazos fuera de tema seguidos antes de cortar la sesión
MAX_TOKENS = int(e("MAX_TOKENS", "500"))
LLM_FAKE = flag("LLM_FAKE")  # LLM determinista para e2e, sin red
TRUSTED_HOPS = int(e("TRUSTED_PROXY_HOPS", "1"))  # proxies delante del servicio: de X-Forwarded-For se toma la entrada que añadió el último

# En producción no se arranca con la clave de servicio de desarrollo ni con otras URLs por defecto.
if e("ENV") == "production":
    _missing = [k for k in ("DATABASE_URL", "CORE_URL", "SERVICE_KEY", "ALLOWED_ORIGINS") if not e(k)]
    if _missing:
        raise RuntimeError(f"Faltan variables de entorno: {', '.join(_missing)}")
    if SERVICE_KEY == "dev-service-key":
        raise RuntimeError("SERVICE_KEY no puede ser la clave de desarrollo")
MAX_INPUT = 1000
MAX_STEPS = 5

# El LLM falso solo vale contra un núcleo local: en producción respondería en falso sin avisar.
if LLM_FAKE and not CORE_URL.startswith(("http://localhost", "http://127.0.0.1")):
    raise RuntimeError("LLM_FAKE solo se permite con CORE_URL local")
