---
name: scaffold-entity
description: Scaffold a new CRUD entity end-to-end (Prisma model + zod validation + API routes + dashboard page) following the template's soft-delete + audit + RBAC invariants. Use when the user says "add a new entity", "scaffold X", "new model for Y", or "/scaffold-entity".
---

# Scaffold Entity

Given an entity name (PascalCase, singular -- e.g. `Project`), generate the seven moving parts the template requires for a CRUD resource. **Stops before running the migration** so the user reviews the schema diff first.

## Inputs to gather first
- **Entity name** (PascalCase, singular). Examples: `Project`, `Invoice`, `TimeEntry`. Derived: snake_case table name, kebab-case path segment, camelCase Prisma field accessor.
- **Fields** (at minimum: `name`; ask for others). For each: name, Prisma type, optional?, indexed?, unique?
- **Soft-delete?** Default yes. If no, skip the `deletedAt`/`deletedBy` columns and the soft-delete registration.
- **Admin-only writes?** Default no (any authenticated user can write). If yes, write routes use `withAdminAuth`.

## Steps
1. **Append model to `prisma/schema.prisma`** at the bottom. Include `id @id @default(cuid())`, `createdAt @default(now())`, `updatedAt @updatedAt`, and `deletedAt DateTime?` + `deletedBy String?` if soft-deletable. Map to snake_case table name with `@@map`. Map field names to snake_case columns with `@map` where they would not match.
2. **Register soft-delete** (if applicable) -- add `"<EntityName>"` to `SOFT_DELETE_MODELS` in `lib/prisma/soft-delete-extension.ts`. Same commit as step 1, never separate.
3. **Register in recycling bin** (if soft-deletable) -- add to `ENTITY_TYPES` in `app/api/recycling-bin/route.ts` so the entity shows up in the restore UI.
4. **Create zod schemas** -- `lib/validations/<entity-kebab>.ts` exporting `create<Entity>Schema` and `update<Entity>Schema`. Mirror the Prisma field types; `optional()` for nullable fields.
5. **Create list/create route** -- `app/api/<entity-kebab>/route.ts`. `GET` returns a paginated list using helpers from `lib/pagination.ts`. `POST` validates with `create<Entity>Schema` then calls `prisma.<entity>.create`. Wrap the whole module's handlers with `withAuth` (or `withAdminAuth` if admin-only writes) from `lib/api-helpers.ts`.
6. **Create item route** -- `app/api/<entity-kebab>/[id]/route.ts`. `GET`, `PUT`, `DELETE` handlers. Same wrappers. `DELETE` becomes a soft-delete automatically via the Prisma extension if the model is registered in step 2 -- do not branch on it.
7. **Create dashboard page** -- `app/[locale]/(dashboard)/<entity-kebab>/page.tsx` using the shared `DataTable` from `components/shared/`. Include columns for each field + actions (edit, delete, and -- if soft-deletable -- a "recycling bin" link).

## After scaffolding -- report to the user
- Print the schema diff (just the new model block).
- Tell the user to run `npm run prisma:migrate -- --name add_<entity-snake>` to apply the migration.
- Remind them to add a sidebar nav entry in `components/layout/Sidebar` if they want the page linkable.
- Suggest running `/ship` once they have committed the migration files.

## Hard rules to preserve
- Every API handler goes through `withAuth` / `withAdminAuth` from `lib/api-helpers.ts`. Never bare.
- Use `prisma` (not `prismaUnfiltered`) -- soft-deleted rows must be filtered out of normal queries.
- Validate `req.json()` with zod before passing to Prisma. Never trust client input.
- snake_case table/column names via `@@map`/`@map`; camelCase Prisma fields and TS; PascalCase Prisma models and React components.
- No client component imports from `lib/prisma`. Pages do their own `fetch` against the API routes.

## Do NOT
- Do NOT run `prisma migrate dev` automatically -- the user reviews the schema diff first.
- Do NOT add the new entity to the audit `EXCLUDE` set -- every project entity should be audited.
- Do NOT add fields that hold Restricted data (passwords, tokens, salaries, API keys) without first scrubbing them in `lib/prisma/audit-extension.ts`. Otherwise they leak into `audit_logs.before`/`after`. See SECURITY.md §5 and finding T-03.
- Do NOT include the entity in `EXCLUDE` of `soft-delete-extension.ts`. That set is for Auth.js bookkeeping tables only.
