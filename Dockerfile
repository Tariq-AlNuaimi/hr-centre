# Self-host image for the app (ADR-023). OPT-IN second rail -- Vercel + Neon
# (ADR-006) remains the default deploy path. This exists so a fork that needs
# on-prem / air-gapped / Kubernetes hosting can ship a container without
# restructuring. Build it with `make docker-build` (which sets DOCKER_BUILD=1 so
# next.config.ts emits `output: "standalone"`).
#
# Multi-stage so the runtime image carries only the traced standalone server +
# the Prisma client, not the full dev dependency tree.

# ---- deps: install with a warm, cacheable layer ----------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# libc compat for some native deps (e.g. Prisma engines) on alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- builder: generate Prisma client + standalone Next build ---------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Emit the standalone server. A dummy DATABASE_URL lets `prisma generate` and the
# build run without a live DB; the real URL is injected at runtime, not baked in.
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
RUN npm run build

# ---- runner: minimal runtime --------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user (defense in depth; never run app containers as root).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone output bundles a minimal node_modules + server.js. Static assets
# and the public dir are copied alongside it per Next's standalone contract.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma client + schema/migrations so `prisma migrate deploy` can run at start.
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

# DATABASE_URL (and any auth/SMTP env) must be injected at runtime, never baked
# into the image. Migrations run forward-only on boot (matches the Vercel
# buildCommand contract); keep them small + forward-compatible (CLAUDE.md).
# `migrate deploy` applies pending migrations only -- it never generates or
# resets -- so it is safe to run on every container start.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node server.js"]
