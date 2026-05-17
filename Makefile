.PHONY: dev setup db-up db-down db-migrate db-seed db-studio docker-build docker-up docker-down docker-pull

# Start dev services (db + minio + app from GHCR) for local testing
dev:
	docker compose up -d

# First-time local dev setup: install deps, start db+minio, migrate, seed
# Use this when developing the template itself (not consuming it)
setup:
	npm install
	docker compose up -d db minio minio-init
	sleep 3
	npx prisma generate
	npx prisma migrate dev
	npx prisma db seed

# Database services only (for local Next.js dev)
db-up:
	docker compose up -d db minio minio-init

db-down:
	docker compose down

db-migrate:
	npx prisma migrate dev

db-seed:
	npx prisma db seed

db-studio:
	npx prisma studio

# Build production image locally
docker-build:
	docker build -t ghcr.io/rihal-om/fullstack-next-template:latest .

# Pull latest image from GHCR
docker-pull:
	docker pull ghcr.io/rihal-om/fullstack-next-template:latest

# Staging/production stack (Portainer-managed)
docker-up:
	docker compose -f docker-compose.prod.yml up -d

docker-down:
	docker compose -f docker-compose.prod.yml down
