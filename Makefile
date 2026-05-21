.PHONY: dev db-up db-down db-migrate db-seed db-studio setup

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
