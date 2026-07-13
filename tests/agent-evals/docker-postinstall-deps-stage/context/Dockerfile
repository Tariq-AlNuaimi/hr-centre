# context: the repo's existing Dockerfile (unchanged by the diff under review).
# Note the deps stage: npm ci runs with ONLY package.json + the lockfile in the
# build context -- no source.config.ts, no content/ sources.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
