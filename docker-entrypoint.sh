#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Seeding database (idempotent)..."
npx prisma db seed || echo "Seed skipped or failed (non-fatal)"

echo "Starting application..."
exec node server.js
