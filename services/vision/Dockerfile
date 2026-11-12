FROM python:3.13-slim
# opencv-contrib-python (lo exige MediaPipe) necesita estas bibliotecas del sistema
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# uv run no debe volver a instalar las dependencias de desarrollo al arrancar el contenedor
ENV UV_NO_DEV=1
WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY app ./app
CMD ["uv", "run", "python", "-m", "app.main"]
