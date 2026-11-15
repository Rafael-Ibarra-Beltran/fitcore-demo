# Contexto de build = raíz del repo (el núcleo depende de packages/shared y de bun.lock):
#   docker build -f services/core/Dockerfile .
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production --filter @fitcore/core
ENV NODE_ENV=production
WORKDIR /app/services/core
EXPOSE 3000
CMD ["bun", "src/index.ts"]
