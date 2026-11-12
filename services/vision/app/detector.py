"""Conteo de personas con MediaPipe (EfficientDet-Lite0, COCO). Solo devuelve un entero: no guarda imágenes."""
import logging
import urllib.request
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

log = logging.getLogger("vision")

# Un contador recibe un fotograma BGR y su marca de tiempo (ms, creciente) y devuelve cuántas personas ve.
Counter = Callable[[np.ndarray, int], int]


def ensure_model(path: Path, url: str) -> Path:
    """Descarga el modelo la primera vez (no se versiona). Se escribe a un temporal para no dejar un archivo a medias."""
    if path.exists() and path.stat().st_size > 100_000:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("Descargando el modelo a %s", path)
    tmp = path.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 - URL fija de Google configurada en config.py
    if tmp.stat().st_size < 100_000:
        tmp.unlink()
        raise RuntimeError(f"La descarga de {url} no parece un modelo válido")
    tmp.rename(path)
    return path


class PersonCounter:
    def __init__(self, model_path: Path, score_threshold: float):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        self._detector = vision.ObjectDetector.create_from_options(
            vision.ObjectDetectorOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                running_mode=vision.RunningMode.VIDEO,
                score_threshold=score_threshold,
                category_allowlist=["person"],
                max_results=100,
            )
        )

    def __call__(self, frame_bgr: np.ndarray, ts_ms: int) -> int:
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        return len(self._detector.detect_for_video(image, ts_ms).detections)
