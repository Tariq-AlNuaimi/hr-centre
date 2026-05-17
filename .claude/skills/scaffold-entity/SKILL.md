---
name: scaffold-entity
description: Scaffold a new CRUD entity end-to-end (Prisma model + zod validation + API routes + dashboard pages + sidebar nav + recycling-bin registration). Backed by scripts/scaffold-entity.mjs. Use when the user says "add a new entity", "scaffold X", "new model for Y", or "/scaffold-entity".
---

# Scaffold Entity

Generate a new CRUD entity mirroring the User reference implementation. The actual codegen lives in `scripts/scaffold-entity.mjs`; this skill orchestrates the inputs and reports the result.

## Inputs to gather first
- **Entity name** (PascalCase, singular). Examples: `Project`, `Invoice`, `TimeEntry`.
- **Fields** as a comma-separated list of `name:type[?][!]` where:
  - `type` is one of: `string`, `text`, `int`, `float`, `boolean`, `date`, `datetime`, `json`
  - `?` marks the field optional
  - `!` adds a DB index
  - Example: `name:string,description:text?,status:string!,price:float`
- **Soft-delete?** Default yes. If no, pass `--soft-delete false`.
- **Admin-only writes?** Default no. If yes, pass `--admin-writes true` (POST / PUT / DELETE wrap with `withAdminAuth`).
- **Display field** for the recycling bin. Default `name`. Override with `--display-field title` if your entity has no `name` field.

## Steps
1. Confirm the entity name and field list with the user.
2. Run the codegen:
   ```
   npm run scaffold -- --name <Pascal> --fields '<spec>' [--soft-delete true|false] [--admin-writes true|false] [--display-field <field>]
   ```
3. The script generates 8 new files and patches 4 existing ones (schema + soft-delete registry + recycling-bin registry + sidebar). It stops before running the migration.
4. Report the schema diff to the user (just the new `model` block).
5. Tell the user to run:
   ```
   npm run prisma:migrate -- --name add_<snake>
   npm run prisma:generate
   ```
6. Suggest running `/ship` (or relying on CI) to verify typecheck + lint + build pass.

## What gets generated
- `prisma/schema.prisma` -- new model appended
- `lib/validations/<kebab>.ts` -- `create<Entity>Schema` + `update<Entity>Schema` (zod)
- `app/api/<kebab>/route.ts` -- GET list (paginated, with search if the entity has a non-optional string field) + POST create
- `app/api/<kebab>/[id]/route.ts` -- GET / PUT / DELETE
- `components/<kebab>/<Pascal>Columns.tsx` -- DataTable columns
- `components/<kebab>/<Pascal>Form.tsx` -- Ant Form with widgets chosen per field type
- `app/[locale]/(dashboard)/<kebab>/page.tsx` -- list page
- `app/[locale]/(dashboard)/<kebab>/new/page.tsx` -- create page
- `app/[locale]/(dashboard)/<kebab>/[id]/page.tsx` -- edit page

## What gets patched
- `lib/prisma/soft-delete-extension.ts` -- `SOFT_DELETE_MODELS` set
- `app/api/recycling-bin/route.ts` -- `ENTITY_TYPES` registry
- `components/layout/AppSidebar.tsx` -- new nav item above `recycling-bin`

## Hard rules preserved by the codegen
- Every API handler wraps with `withAuth` / `withAdminAuth` -- never bare.
- Uses `prisma` (not `prismaUnfiltered`) so soft-deleted rows stay filtered.
- zod parses request bodies before any Prisma call.
- snake_case `@@map` for the table name; camelCase Prisma fields; PascalCase model.
- The entity is **not** added to the audit `EXCLUDE` set -- writes are auto-audited.

## Do NOT
- Do NOT run `prisma migrate dev` automatically -- the user reviews the schema diff first.
- Do NOT add fields holding Restricted data (passwords, tokens, salaries, API keys) without first extending `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts`. Otherwise the values leak into `audit_logs.before` / `after`. See SECURITY.md §5 + finding T-03.
- Do NOT include the entity in `EXCLUDE` of `soft-delete-extension.ts`. That set is for Auth.js bookkeeping tables only.

## Idempotency
The script refuses to overwrite an existing entity. To regenerate after a typo, delete the generated files and the schema block first.

## After scaffold polish (manual, project-specific)
The generated UI is functional but generic. Common polish:
- Replace hardcoded English labels with `useTranslations("<kebab>")` + add keys to `messages/en.json` and `messages/ar.json`.
- Tweak `<Pascal>Columns.tsx` rendering (date formats, status tags, currency).
- Adjust the form widgets in `<Pascal>Form.tsx` if a field needs a Select / cascader / etc.
- If the entity should be admin-only in the sidebar, move the nav entry inside the `isAdmin ? [...]` block in `AppSidebar.tsx`.
