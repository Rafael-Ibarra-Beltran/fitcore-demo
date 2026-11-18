"""Único punto de contacto con el proveedor de LLM (LiteLLM). Los tests lo sustituyen."""
import logging
import warnings

import litellm

from . import config

# LiteLLM vuelca trazas enormes al reintentar o caer al modelo de respaldo; los errores reales siguen subiendo como excepción.
litellm.suppress_debug_info = True
logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
warnings.filterwarnings("ignore", message="Pydantic serializer warnings")


def _completion(messages: list, tools: list, **kw):
    return litellm.completion(
        model=config.LLM_MODEL,
        messages=messages,
        tools=tools,
        num_retries=2,
        fallbacks=[config.LLM_FALLBACK_MODEL] if config.LLM_FALLBACK_MODEL else None,
        timeout=30,
        max_tokens=config.MAX_TOKENS,
        **kw,
    )


def chat(messages: list, tools: list):
    return _completion(messages, tools)


def _stream_models(messages: list, tools: list):
    """Respaldo manual: `fallbacks` de LiteLLM está roto con stream=True (devuelve una corrutina y lanza MidStreamFallbackError).
    Se cae al modelo de respaldo solo si el principal falla antes de emitir el primer chunk; a mitad de respuesta se propaga el error."""
    models = [config.LLM_MODEL, *([config.LLM_FALLBACK_MODEL] if config.LLM_FALLBACK_MODEL else [])]
    for i, model in enumerate(models):
        started = False
        try:
            for ch in litellm.completion(model=model, messages=messages, tools=tools, num_retries=2, timeout=30,
                                         max_tokens=config.MAX_TOKENS, stream=True):
                started = True
                yield ch
            return
        except Exception:
            if started or i == len(models) - 1:
                raise


def stream(messages: list, tools: list):
    """Chunks de la respuesta. Con LLM_FAKE responde sin red: la primera vez llama a una herramienta según el texto."""
    if config.LLM_FAKE:
        return _fake_stream(messages)
    return _stream_models(messages, tools)


def _chunk(content=None, calls=None):
    from types import SimpleNamespace as NS
    return NS(choices=[NS(delta=NS(content=content, tool_calls=calls))])


def _fake_stream(messages: list):
    from types import SimpleNamespace as NS
    last = messages[-1]
    if last["role"] == "tool":
        yield _chunk("Listo, ya revisé eso. ")
        yield _chunk("¿Algo más del gimnasio?")
        return
    text = last["content"].lower()
    tool = ("fuera_de_tema", '{"motivo": "prueba"}') if "receta" in text or "python" in text else \
           ("listar_clases", "{}") if "clase" in text else ("consultar_ocupacion", "{}") if "aforo" in text else None
    if tool:
        yield _chunk(calls=[NS(index=0, id="fake1", function=NS(name=tool[0], arguments=tool[1]))])
    else:
        yield _chunk("Hola, soy el asistente del gimnasio. ")
        yield _chunk("Pregúntame por clases, planes o aforo.")


def embed(texts: list[str]) -> list[list[float]]:
    r = litellm.embedding(model=config.EMBED_MODEL, input=texts, dimensions=config.EMBED_DIM)
    return [d["embedding"] for d in r.data]
