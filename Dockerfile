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
FROM node:24.22.1-bookworm-slim AS deps
WORKDIR /app
# openssl + ca-certificates so the Prisma engine download/generate is reliable
# on the slim base (slim strips these); cheap, cached, and build-only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# --ignore-scripts (ADR-051 install-time hardening): lifecycle scripts are the npm
# worm era's entry point (Shai-Hulud, chalk/debug), so NO package in the ~1.5k-dep
# tree may run arbitrary code at install. The explicit `npm rebuild` allowlist then
# runs scripts for ONLY the packages that genuinely need them:
#   @prisma/engines  -- downloads the schema engine (`prisma migrate deploy` at boot)
#   @sentry/cli      -- fetches the sentry-cli binary (next-build sourcemap plugin)
#   sharp            -- verifies the prebuilt libvips binding (Next image optimization)
#   @swc/core        -- verifies the prebuilt binding (next-intl build tooling)
#   esbuild          -- verifies the prebuilt binary (tsx: prisma seed/config loading)
#   unrs-resolver    -- verifies the prebuilt binding (eslint import resolver, CI lint)
# NOT allowlisted (verified 2026-07-13): @node-rs/argon2 has NO install script (its
# native binding ships as a platform optionalDependency), and the fork-only guarded
# docs-site postinstall (scripts/enable-docs-site.mjs) is a deliberate no-op here --
# `next build` in the builder stage regenerates .source. Keep this list in lockstep
# with the CI install sites (verify/uat/preview-uat/release workflows).
RUN npm ci --no-audit --no-fund --ignore-scripts \
  && npm rebuild @prisma/engines @sentry/cli sharp @swc/core esbuild unrs-resolver @parcel/watcher

# ---- builder: generate Prisma client + standalone Next build ---------------
FROM node:24.22.1-bookworm-slim AS builder
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
# Build-only placeholder for AUTH_SECRET: lib/env.ts validates the full env with
# zod at module load, which `next build` triggers while collecting page data (e.g.
# /api/internal/audit-purge). AUTH_SECRET has no default and z.string().min(32),
# so the build fails without one. This is NOT a secret and is NOT baked into the
# runtime image — Next reads server env from process.env at runtime (non-public
# vars are never inlined); the real AUTH_SECRET is injected at `docker run`, like
# DATABASE_URL. On Vercel this never surfaced because AUTH_SECRET is configured there.
ENV AUTH_SECRET="build-only-placeholder-not-a-secret-0000000"
RUN npx prisma generate
RUN npm run build
# Prune devDependencies so the node_modules copied into the runtime is the full
# PRODUCTION closure. `prisma` is a runtime dependency (the entrypoint runs
# `prisma migrate deploy` at boot), and the Prisma 7 CLI loads @prisma/config →
# effect/c12/jiti + iconv-lite etc. at runtime — a closure the Next standalone
# trace does NOT include (it only traces the server's own imports, e.g.
# @prisma/client). Copying just node_modules/prisma + @prisma is insufficient and
# crashes at boot ("Cannot find module 'effect'").
RUN npm prune --omit=dev

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
# `prisma migrate deploy` can run at start.
COPY --from=builder --chown=nonroot:nonroot /app/generated ./generated
COPY --from=builder --chown=nonroot:nonroot /app/prisma ./prisma
# Prisma 7 resolves the datasource url from prisma.config.ts (schema.prisma has no
# `url`), so `migrate deploy` needs it at runtime (the CLI loads it via jiti).
COPY --from=builder --chown=nonroot:nonroot /app/prisma.config.ts ./prisma.config.ts
# The full PRODUCTION node_modules (devDeps pruned in the builder). This overlays
# the minimal set the standalone trace already emitted, adding the Prisma 7 CLI's
# runtime closure (@prisma/config → effect/c12/jiti, iconv-lite, …) that
# `migrate deploy` needs at boot. Cherry-picking prisma + @prisma alone is NOT
# enough — the CLI crashes on the first missing transitive dep.
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules

# The distroless-safe startup script (no shell available): migrate then serve.
COPY --from=builder --chown=nonroot:nonroot /app/docker/entrypoint.mjs ./docker/entrypoint.mjs

EXPOSE 3000

# DATABASE_URL (and any auth/SMTP env) are injected at runtime, never baked into
# the image. The entrypoint runs `prisma migrate deploy` (forward-only, safe on
# every boot) then starts `server.js` in-process. Distroless runs this as
# `node docker/entrypoint.mjs`.
CMD ["docker/entrypoint.mjs"]
