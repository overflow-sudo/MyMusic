# Build context is the repository root (see compose.yaml): the server imports ../shared.
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 mymusic \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mymusic \
 && mkdir /data && chown 10001:10001 /data
WORKDIR /app
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/package.json ./package.json
COPY server/public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=8120
USER mymusic
VOLUME /data
EXPOSE 8120
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:8120/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","dist/server/src/main.js"]
