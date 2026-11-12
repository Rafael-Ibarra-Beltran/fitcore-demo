import logging
from datetime import datetime, timezone

import httpx

from . import config

log = logging.getLogger("vision")


def publish(people: int, client: httpx.Client | None = None, at: datetime | None = None) -> bool:
    """Envía el conteo al núcleo. Solo salen la cámara, el número y la hora: nunca imágenes."""
    body = {"camera": config.CAMERA_NAME, "people": people, "at": (at or datetime.now(timezone.utc)).isoformat()}
    owns = client is None
    client = client or httpx.Client(timeout=10)
    try:
        for attempt in (1, 2):  # el núcleo en Render tarda en despertar: un reintento
            try:
                r = client.post(f"{config.CORE_URL}/api/occupancy", json=body, headers={"x-service-key": config.SERVICE_KEY})
                if r.status_code < 300:
                    return True
                log.warning("El núcleo respondió %s (intento %s)", r.status_code, attempt)
            except httpx.HTTPError as e:
                log.warning("No se pudo contactar al núcleo (intento %s): %s", attempt, e)
        # shortcut: la lectura se descarta, sin cola local; el siguiente reporte llega en REPORT_EVERY segundos.
        return False
    finally:
        if owns:
            client.close()
