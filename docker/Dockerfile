# syntax=docker/dockerfile:1

FROM node:24-slim AS base
RUN npm install -g pnpm@12.18.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY packages/catalog/package.json packages/catalog/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/providers packages/providers
COPY packages/catalog packages/catalog
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm run build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY packages/catalog/package.json packages/catalog/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
# Baked by the release workflow; local builds show "dev" (#74).
ARG DRAUF_VERSION=dev
ARG DRAUF_COMMIT=""
ENV NODE_ENV=production
ENV DRAUF_VERSION=$DRAUF_VERSION
ENV DRAUF_COMMIT=$DRAUF_COMMIT
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/server/node_modules apps/server/node_modules
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/providers/package.json packages/providers/
COPY --from=build /app/packages/providers/dist packages/providers/dist
COPY packages/catalog/package.json packages/catalog/
COPY --from=build /app/packages/catalog/dist packages/catalog/dist
COPY packages/catalog/data packages/catalog/data
# The workspace link @drauf/shared -> ../../../shared lives in the package's
# own node_modules; without it the catalogue cannot resolve its import at
# runtime (the build-only CI image check never caught that — the smoke test
# in ci.yml does now).
COPY --from=prod-deps /app/packages/catalog/node_modules packages/catalog/node_modules
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
# Served by the server at / (WEB_DIR defaults to ../web/dist).
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir /data && chown node:node /data
ENV DATA_DIR=/data
USER node
EXPOSE 3000
WORKDIR /app/apps/server
# The slim image has no curl; /healthz answers without auth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch(\`http://127.0.0.1:\${process.env.PORT ?? 3000}/healthz\`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]
