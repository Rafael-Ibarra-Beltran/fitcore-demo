import httpx

from . import config


def call(method: str, path: str, **kw) -> tuple[int, object]:
    r = httpx.request(method, config.CORE_URL + path, headers={"x-service-key": config.SERVICE_KEY}, timeout=10, **kw)
    try:
        body = r.json()
    except ValueError:
        body = {"error": r.text[:200]}
    return r.status_code, body


def get(path: str, **params):
    status, body = call("GET", path, params=params)
    if status >= 400:
        raise RuntimeError(f"core {path}: {status} {body}")
    return body
