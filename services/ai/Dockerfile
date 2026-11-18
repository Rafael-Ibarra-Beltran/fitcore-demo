FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# uv run no debe volver a instalar las dependencias de desarrollo al arrancar el contenedor
ENV UV_NO_DEV=1
WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY app ./app
# Detrás del proxy de Render: sin esto el rate limit por IP vería siempre la IP del proxy.
# En Render hay que definir ENV=production (activa el guard de config.py); en local no.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
