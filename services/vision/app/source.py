from time import monotonic
from typing import Iterator

import cv2
import numpy as np


def frames(source: str, sample_fps: float, loop: bool) -> Iterator[np.ndarray]:
    """Fotogramas muestreados a `sample_fps`. `source` es un archivo de video o el índice de una webcam."""
    is_camera = source.isdigit()
    cap = cv2.VideoCapture(int(source) if is_camera else source)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir {'la cámara' if is_camera else 'el video'} '{source}'")
    try:
        if is_camera:
            yield from _from_camera(cap, sample_fps)
        else:
            yield from _from_file(cap, sample_fps, loop)
    finally:
        cap.release()


def _from_file(cap: cv2.VideoCapture, sample_fps: float, loop: bool) -> Iterator[np.ndarray]:
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    step = max(1, round(fps / sample_fps)) if fps > 0 else 1
    i = yielded_in_pass = 0
    while True:
        if not cap.grab():  # fin del archivo (o error de lectura)
            if not loop or yielded_in_pass == 0:  # un archivo vacío o ilegible no debe repetirse sin fin
                return
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            i = yielded_in_pass = 0
            continue
        if i % step == 0:  # solo se decodifican los fotogramas que se van a analizar
            ok, frame = cap.retrieve()
            if ok:
                yielded_in_pass += 1
                yield frame
        i += 1


def _from_camera(cap: cv2.VideoCapture, sample_fps: float) -> Iterator[np.ndarray]:
    last = 0.0
    while True:
        ok, frame = cap.read()  # se lee siempre para vaciar el búfer de la cámara y no analizar imágenes viejas
        if not ok:
            return
        if monotonic() - last >= 1 / sample_fps:
            last = monotonic()
            yield frame
