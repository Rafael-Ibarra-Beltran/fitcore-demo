"""Único punto de contacto con el proveedor de LLM (LiteLLM). Los tests lo sustituyen."""
import logging
import warnings

import litellm

from . import config

# LiteLLM vuelca trazas enormes al reintentar o caer al modelo de respaldo; los errores reales siguen subiendo como excepción.
litellm.suppress_debug_info = True
logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
warnings.filterwarnings("ignore", message="Pydantic serializer warnings")


def chat(messages: list, tools: list):
    return litellm.completion(
        model=config.LLM_MODEL,
        messages=messages,
        tools=tools,
        num_retries=2,
        fallbacks=[config.LLM_FALLBACK_MODEL] if config.LLM_FALLBACK_MODEL else None,
        timeout=30,
    )


def embed(texts: list[str]) -> list[list[float]]:
    r = litellm.embedding(model=config.EMBED_MODEL, input=texts, dimensions=config.EMBED_DIM)
    return [d["embedding"] for d in r.data]
