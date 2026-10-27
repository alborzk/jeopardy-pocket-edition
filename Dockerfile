# One long-running Node process: serves the built client and the Socket.IO server on one port.
# Rooms live in memory, so run a single instance (no autoscaling, no serverless).

FROM node:24-slim AS build
ENV CI=true
# Picks up the pnpm version pinned in package.json ("packageManager").
RUN corepack enable
WORKDIR /app

# Install first, from the manifests only, so this layer is cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# The server is a single bundle with its dependencies inlined, so nothing else is needed.
# package.json is only here so Node knows dist/index.js is an ES module.
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
