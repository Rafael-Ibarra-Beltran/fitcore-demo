"""Worker de aforo: lee un video o webcam, cuenta personas y reporta al núcleo cada REPORT_EVERY segundos.

    uv run python -m app.main                    # reporta de forma continua
    uv run python -m app.main --once --dry       # cuenta el archivo completo e imprime cada muestra (sin publicar)
"""
import argparse
import logging
import sys
import time
from statistics import median
from typing import Callable, Iterable

from . import config, detector, publisher, source
from .aggregate import Window

log = logging.getLogger("vision")


def run(
    counter: detector.Counter,
    frames: Iterable,
    publish: Callable[[int], object],
    *,
    report_every: float,
    sample_fps: float,
    pace: bool = True,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    on_sample: Callable[[int, int], None] = lambda i, n: None,
) -> list[int]:
    """Cuenta cada fotograma, reporta la mediana de cada ventana y devuelve todos los conteos."""
    window, counts, interval = Window(report_every), [], 1 / sample_fps
    for i, frame in enumerate(frames):
        t0 = clock()
        n = counter(frame, int(i * interval * 1000))  # la marca de tiempo debe crecer aunque el video se repita
        counts.append(n)
        on_sample(i, n)
        window.add(n, t0)
        if window.due(t0):
            people = window.flush()
            log.info("Reporte: %s personas", people)
            publish(people)
        if pace:
            sleep(max(0.0, interval - (clock() - t0)))
    return counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="recorre el archivo una vez, sin pausas, imprimiendo cada muestra")
    ap.add_argument("--dry", action="store_true", help="no publica al núcleo")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if not config.VIDEO_SOURCE:
        sys.exit("Define VIDEO_SOURCE en .env: la ruta de un video o el índice de la webcam (0).")

    model = detector.ensure_model(config.MODEL_PATH, config.MODEL_URL)
    counter = detector.PersonCounter(model, config.SCORE_THRESHOLD)
    frames = source.frames(config.VIDEO_SOURCE, config.SAMPLE_FPS, loop=config.LOOP and not args.once)
    publish = (lambda people: None) if args.dry else publisher.publish
    on_sample = (lambda i, n: print(f"muestra {i}: {n} personas")) if args.once else (lambda i, n: None)
    try:
        counts = run(counter, frames, publish, report_every=config.REPORT_EVERY, sample_fps=config.SAMPLE_FPS,
                     pace=not args.once, on_sample=on_sample)
    except KeyboardInterrupt:
        return 0
    if args.once and counts:
        print(f"{len(counts)} muestras · mediana {round(median(counts))} · máximo {max(counts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
