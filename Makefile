.PHONY: dev db-up db-down db-migrate db-seed db-studio db-sql setup docker-build docker-run docker-up docker-down docker-prod-up docker-prod-down browser-up browser-down browser-status

# Local dev: Postgres in Docker, app via `npm run dev`.
# Production is Vercel + Neon -- see CLAUDE.md.

# First-time local setup
setup:
	npm install
	docker compose up -d db
	sleep 3
	npx prisma generate
	npx prisma migrate dev
	npx prisma db seed

dev:
	npm run dev

db-up:
	docker compose up -d db

db-down:
	docker compose down

db-migrate:
	npx prisma migrate dev

db-seed:
	npx prisma db seed

db-studio:
	npx prisma studio

# Query the DB over HTTPS/443 from a web session, where raw TCP :5432 is firewalled
# (see docs/runbooks/browser-egress-in-web-sessions.md §Bonus). Uses the Neon serverless
# driver. Example: `make db-sql SQL="select count(*) from users"`.
SQL ?= select 1
db-sql:
	node scripts/neon-sql.mjs "$(SQL)"

# --- Browser-egress bridge: headless Chromium online in a web session -----------
# In a Claude Code web session the TLS-MITM egress proxy resets Chromium's ClientHello
# (ERR_CONNECTION_RESET), so /design-qa, /uat, /manual-uat, and the browser MCP servers
# can't reach any real site. `browser-up` chains Chromium through a local mitmdump that
# the proxy accepts. Idempotent + fail-open (a clean no-op off-platform). Root cause +
# fix: docs/runbooks/browser-egress-in-web-sessions.md. After `browser-up`, load the
# launch env with: eval "$(node scripts/browser-bridge.mjs env)"
browser-up:
	node scripts/browser-bridge.mjs up

browser-status:
	node scripts/browser-bridge.mjs status

browser-down:
	node scripts/browser-bridge.mjs down

# --- Docker: standard build artifact (ADR-030; supersedes ADR-023 opt-in) ---
# Production is Vercel + Neon by default (ADR-006) -- unchanged. But the image is
# now a mandatory build artifact: `/ship --full`, /deploy, /handoff, and CI build
# it (docker-build below is the same image that gate produces). Self-host forks
# (on-prem / air-gapped / k8s) run it too. DOCKER_BUILD=1 makes next.config.ts
# emit `output: "standalone"` for a small runtime image.

# Build the app image. Tag override: `make docker-build IMAGE=myrepo/app:1.2.3`
IMAGE ?= app:local
docker-build:
	DOCKER_BUILD=1 docker build -t $(IMAGE) .

# Run the built image against a DATABASE_URL you provide (e.g. a Neon URL or a
# local Postgres). Secrets are passed at runtime, never baked into the image.
docker-run:
	docker run --rm -p 3000:3000 --env-file .env $(IMAGE)

# Full local stack (app + Postgres) via docker-compose.dev.yml.
docker-up:
	docker compose -f docker-compose.dev.yml up -d --build

docker-down:
	docker compose -f docker-compose.dev.yml down

# --- Docker: production self-host topology (ADR-035, compose.prod.yaml) ------
# The Docker-first delivery rail: app + Caddy (TLS) + a bundled pgvector Postgres
# (the `bundled-db` profile — the default an operator gets). Caddy fronts the app
# on :80/:443; migrations run at container start. For an external/managed DB
# (Neon/RDS) use `--profile external-db` instead (see compose.prod.yaml header).
docker-prod-up:
	docker compose -f compose.prod.yaml --profile bundled-db up -d --build

docker-prod-down:
	docker compose -f compose.prod.yaml --profile bundled-db down
