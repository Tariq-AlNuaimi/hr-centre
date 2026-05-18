# Fullstack Next.js Template

Production-ready fullstack template with Next.js, PostgreSQL, MinIO, Auth.js, and Ant Design. Tuned for Claude Code vibe-coding sessions (see `.claude/`) but works for human coders too.

## Stack

- **Framework**: Next.js 16, React 19, TypeScript
- **UI**: Ant Design 6 with dark mode and RTL support
- **Database**: PostgreSQL 17 with Prisma 7 ORM
- **Storage**: MinIO (S3-compatible)
- **Auth**: Auth.js v5 (credentials + OAuth)
- **i18n**: next-intl (English + Arabic)
- **CI/CD**: GitHub Actions - GHCR - Portainer webhook

## Features

- Full audit trail on all entity changes (create, update, delete, restore)
- Soft deletion with recycling bin (restore or permanently delete)
- Role-based access control (Admin, Editor, Viewer)
- Reusable layout with header, collapsible sidebar, breadcrumbs, footer
- Dark mode toggle with system preference detection
- RTL support for Arabic locale
- File upload component with MinIO presigned URLs
- Reusable DataTable with pagination, search, sort
- Health check endpoint for Docker healthcheck

## Claude Code

`.claude/` ships with a permission allowlist, a SessionStart hook that boots dependencies, and two skills tuned for this stack:

- **`/scaffold-entity <Name>`** — generate a full CRUD entity (model, validation, API routes, dashboard page) following the template's soft-delete + audit + RBAC invariants.
- **`/ship`** — typecheck + lint + build before pushing.

The SessionStart hook handles `.env` bootstrap, `npm install`, and `prisma generate` automatically on every session. Humans coding by hand can ignore `.claude/`; it does not affect the runtime build. See [`CLAUDE.md`](./CLAUDE.md) for the rationale and the full hard-rules list.

## Quick Start

```bash
# 1. Clone and install
cp .env.example .env
npm install

# 2. Start services and setup database
make setup

# 3. Start development
make dev
```

The app runs at http://localhost:3000. Login with the credentials from your `.env` file.

## Project Structure

```
.claude/                     # Claude Code harness (settings + hook + skills)
app/
  [locale]/                  # i18n locale segment (en, ar)
    (auth)/login/            # Login page (no sidebar)
    (dashboard)/             # Main app with sidebar layout
      users/                 # Example CRUD entity
      recycling-bin/         # Soft-deleted records
      settings/              # App settings + profile
  api/                       # API routes
    auth/                    # Auth.js handlers
    users/                   # User CRUD endpoints
    recycling-bin/           # Restore + permanent delete
    storage/presign/         # MinIO presigned upload URLs
    health/                  # Health check
components/
  layout/                    # AppShell, Header, Sidebar, Footer, Breadcrumbs
  shared/                    # DataTable, FileUpload, ConfirmAction, EmptyState
  users/                     # Example entity components
hooks/                       # useCrud, useNotify, useBreadcrumb
lib/                         # Prisma client, auth, storage, validations
prisma/                      # Schema, migrations, seed
```

## Adding a New Entity

In a Claude session, run **`/scaffold-entity <Name>`** and follow the prompts.

Manual recipe (for human coders or reference):

1. Add the model to `prisma/schema.prisma` (include `deletedAt DateTime?` and `deletedBy String?` for soft deletion)
2. Run `npx prisma migrate dev --name add_entity`
3. Register the model in `lib/prisma/soft-delete-extension.ts` (`SOFT_DELETE_MODELS.add("YourModel")`)
4. Register in `app/api/recycling-bin/route.ts` (`ENTITY_TYPES`)
5. Create validation schemas in `lib/validations/`
6. Create API routes in `app/api/`
7. Create page components in `app/[locale]/(dashboard)/`

## Docker

```bash
# Development (db + minio only, app runs locally)
docker compose up -d

# Production (all services from GHCR image)
docker compose -f docker-compose.prod.yml up -d

# Build production image locally
make docker-build
```

## CI/CD

Push to `main` triggers the GitHub Actions workflow which:
1. Builds the Docker image
2. Pushes to GitHub Container Registry (ghcr.io)
3. Triggers the Portainer webhook to pull the latest image

Set `PORTAINER_WEBHOOK_URL` in GitHub repository secrets.

## Environment Variables

See `.env.example` for all available configuration options.
