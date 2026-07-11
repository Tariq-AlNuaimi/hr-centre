# Self-host delivery image (ADR-035). Docker is now the PRIMARY self-host
# delivery rail for the enterprise pivot (one dockerized deployment per tenant),
# not the opt-in second rail ADR-023 framed. Vercel + Neon (ADR-006) is retained
# only as an opt-in prototype/preview option. This image is the bootable unit a
# tenant runs inside their own boundary.
#
# Runtime floor is Node 24 Active LTS (ADR-038). Builder stages run on
# `node:24-bookworm-slim` (Debian glibc, NOT alpine/musl — Prisma 7 engines want
# glibc) and the runtime stage is Google distroless (no shell, no package
# manager, non-root by default) for a minimal attack surface.
#
# Base images are pinned to a specific PATCH tag here for readability; a full
# `@sha256:` digest pin (reproducible, immutable) is applied by Renovate / at CI
# build time (ADR-041 supply-chain hardening). Do NOT hand-write a sha256 digest.
#
# Multi-stage so the runtime carries only the traced standalone server + the
# Prisma client/CLI, not the full dev dependency tree.

# ---- deps: install with a warm, cacheable layer ----------------------------
FROM node:24.10.0-bookworm-slim AS deps
WORKDIR /app
# openssl + ca-certificates so the Prisma engine download/generate is reliable
# on the slim base (slim strips these); cheap, cached, and build-only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- builder: generate Prisma client + standalone Next build ---------------
FROM node:24.10.0-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Emit the standalone server. DOCKER_BUILD=1 makes next.config.ts set
# `output: "standalone"`. A dummy DATABASE_URL lets `prisma generate` and the
# build run without a live DB; the real URL is injected at runtime, never baked.
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
RUN npm run build

# ---- runner: distroless, non-root, minimal runtime -------------------------
# The distroless nodejs24 image's ENTRYPOINT is already `node` and it runs as
# the `nonroot` user (uid 65532) by default. There is NO shell here — do not add
# RUN/USER-root steps. The startup command is a Node entrypoint (below).
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone output bundles a minimal node_modules + server.js. Static
# assets and the public dir are copied alongside it per Next's standalone
# contract. Everything is chowned to the nonroot user the image runs as.
COPY --from=builder --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=builder --chown=nonroot:nonroot /app/public ./public

# Prisma generated client + engine (this repo's generator outputs to
# `generated/prisma`, not node_modules/.prisma) plus schema/migrations so
# `prisma migrate deploy` can run at start, and the Prisma CLI + its engine
# packages (the standalone trace does not include the CLI).
COPY --from=builder --chown=nonroot:nonroot /app/generated ./generated
COPY --from=builder --chown=nonroot:nonroot /app/prisma ./prisma
COPY --from=builder --chown=nonroot:nonroot /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nonroot:nonroot /app/node_modules/@prisma ./node_modules/@prisma
# NOTE: this repo's generator is `prisma-client` (Prisma 7) with output to
# `generated/prisma` (copied above), so there is NO legacy `node_modules/.prisma`
# client dir to copy. If a build ever shows the runtime resolving `.prisma/client`
# (e.g. after a generator change), add:
#   COPY --from=builder --chown=nonroot:nonroot /app/node_modules/.prisma ./node_modules/.prisma
# A single non-matching COPY glob fails the build, so this is left as a comment,
# not a defensive wildcard.

# The distroless-safe startup script (no shell available): migrate then serve.
COPY --from=builder --chown=nonroot:nonroot /app/docker/entrypoint.mjs ./docker/entrypoint.mjs

EXPOSE 3000

# DATABASE_URL (and any auth/SMTP env) are injected at runtime, never baked into
# the image. The entrypoint runs `prisma migrate deploy` (forward-only, safe on
# every boot) then starts `server.js` in-process. Distroless runs this as
# `node docker/entrypoint.mjs`.
CMD ["docker/entrypoint.mjs"]
