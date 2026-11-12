import re
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest

from app import aggregate, config, detector, main, publisher, source

APP = Path(__file__).resolve().parent.parent / "app"


def test_window_reports_median_and_resets():
    w = aggregate.Window(60)
    for n, t in [(3, 0), (30, 20), (4, 40)]:  # un parpadeo del detector (30) no debe mover el reporte
        w.add(n, t)
        assert not w.due(t)
    w.add(5, 61)
    assert w.due(61)
    assert w.flush() == 4 and w.samples == [] and not w.due(1000)
    assert w.flush() is None


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_publish_sends_only_camera_people_at_with_service_key():
    seen = []
    ok = publisher.publish(7, client=_client(lambda r: seen.append(r) or httpx.Response(201, json={})))
    assert ok
    req = seen[0]
    assert req.url.path == "/api/occupancy" and req.headers["x-service-key"] == config.SERVICE_KEY
    body = __import__("json").loads(req.content)
    assert set(body) == {"camera", "people", "at"} and body["people"] == 7


def test_publish_retries_once_then_gives_up():
    calls = []
    assert publisher.publish(1, client=_client(lambda r: calls.append(1) or httpx.Response(503))) is False
    assert len(calls) == 2
    attempts = iter([httpx.ConnectError("despertando"), httpx.Response(201)])

    def flaky(_):
        a = next(attempts)
        if isinstance(a, Exception):
            raise a
        return a

    assert publisher.publish(1, client=_client(flaky)) is True


def _video(path: Path, n: int = 30, fps: int = 10):
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (64, 64))
    for i in range(n):
        w.write(np.full((64, 64, 3), i * 8, np.uint8))
    w.release()


def test_file_source_samples_at_one_fps_and_loops(tmp_path):
    v = tmp_path / "v.avi"
    _video(v)  # 30 fotogramas a 10 fps = 3 s
    assert len(list(source.frames(str(v), sample_fps=1, loop=False))) == 3
    it = source.frames(str(v), sample_fps=1, loop=True)
    assert len([next(it) for _ in range(7)]) == 7  # da más vueltas de las que tiene el archivo
    it.close()


def test_source_fails_clearly_on_missing_video_and_does_not_spin_on_empty(tmp_path):
    with pytest.raises(RuntimeError, match="No se pudo abrir"):
        next(source.frames(str(tmp_path / "no-existe.avi"), 1, loop=True))
    empty = tmp_path / "vacio.avi"
    _video(empty, n=0)
    assert list(source.frames(str(empty), 1, loop=True)) == []  # no se queda en un bucle infinito


def test_run_publishes_median_once_per_window_with_increasing_timestamps():
    t = {"now": 0.0}
    stamps, published = [], []
    seq = iter([3, 3, 40, 5, 6, 6, 6, 6])

    def counter(frame, ts):
        stamps.append(ts)
        return next(seq)

    def clock():
        return t["now"]

    def sleep(s):
        t["now"] += 1.0  # cada muestra "tarda" un segundo

    counts = main.run(counter, range(8), published.append, report_every=3, sample_fps=1, clock=clock, sleep=sleep)
    assert counts == [3, 3, 40, 5, 6, 6, 6, 6]
    # Ventanas de 3 s: la primera cierra a los 3 s con [3, 3, 40, 5] (mediana 4, el 40 es un parpadeo); la segunda con [6, 6, 6, 6].
    assert published == [4, 6]
    assert stamps == sorted(set(stamps))  # estrictamente crecientes: MediaPipe lo exige


def test_code_never_writes_images_or_video():
    code = "\n".join(p.read_text() for p in APP.glob("*.py"))
    assert not re.search(r"imwrite|imencode|VideoWriter|\.save\(|tobytes\(", code), "el worker no debe guardar imágenes"


@pytest.mark.model
@pytest.mark.skipif(__import__("os").environ.get("RUN_MODEL_TEST") != "1", reason="usa el modelo real; RUN_MODEL_TEST=1 para correrlo")
def test_real_detector_sees_no_people_in_a_blank_frame():
    model = detector.ensure_model(config.MODEL_PATH, config.MODEL_URL)
    counter = detector.PersonCounter(model, config.SCORE_THRESHOLD)
    assert counter(np.zeros((240, 320, 3), np.uint8), 0) == 0
