import os
from pathlib import Path

e = os.environ.get

CORE_URL = e("CORE_URL", "http://localhost:3000").rstrip("/")
SERVICE_KEY = e("SERVICE_KEY", "dev-service-key")
CAMERA_NAME = e("CAMERA_NAME", "sala-principal")
# Ruta de un archivo de video o índice de webcam (0, 1…). Sin valor por defecto: hay que elegirlo a propósito.
VIDEO_SOURCE = e("VIDEO_SOURCE", "")
SAMPLE_FPS = float(e("SAMPLE_FPS", "1"))  # fotogramas analizados por segundo
REPORT_EVERY = float(e("REPORT_EVERY", "60"))  # segundos entre reportes al núcleo
SCORE_THRESHOLD = float(e("SCORE_THRESHOLD", "0.35"))
LOOP = e("LOOP", "1") == "1"  # repetir el archivo al llegar al final (simula una cámara continua)

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_PATH = Path(e("MODEL_PATH", str(MODEL_DIR / "efficientdet_lite0.tflite")))
# float32 es el más preciso; a 1 fotograma por segundo la velocidad en CPU no importa. int8/float16 son más ligeros.
MODEL_URL = e("MODEL_URL", "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/latest/efficientdet_lite0.tflite")
