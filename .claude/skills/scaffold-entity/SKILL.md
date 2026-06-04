---
name: scaffold-entity
description: Scaffold a new CRUD entity end-to-end -- Prisma model (with enums + FK relations) + zod validation + API routes + dashboard pages + sidebar nav + recycling-bin registration. Backed by scripts/scaffold-entity.mjs. Use when the user says "add a new entity", "scaffold X", "new model for Y", or "/scaffold-entity".
---

# Scaffold Entity

Generate a new CRUD entity mirroring the User reference implementation. Codegen lives in `scripts/scaffold-entity.mjs`; this skill orchestrates inputs and reports the result.

## Inputs to gather

- **Entity name** (PascalCase, singular). Examples: `Project`, `Invoice`, `TimeEntry`.
- **Scalar fields** (optional): `--fields name:type[?][!],...`
  - types: `string`, `text`, `int`, `float`, `boolean`, `date`, `datetime`, `json`
  - `?` = optional, `!` = indexed
- **Enums** (optional): `--enums name:VAL1|VAL2|VAL3[?],...`
  - First value is the default unless `?` is set
  - Enum type name is `<Entity><FieldPascal>` (e.g. `TaskStatus`)
- **Relations** (optional): `--relations fieldName:TargetModel[?],...`
  - Target model must already exist in `prisma/schema.prisma`
  - Scaffold auto-adds the back-ref (e.g. `tasks Task[]`) to the target model
  - Adds `<name>Id` FK column + `@@index([<name>Id])` to the source
  - Detects the target's display field automatically (`name` > `title` > `label` > `email` > `id`), used by both the column traversal and the searchable `RelationSelect`
- **Soft-delete?** Default yes. Pass `--soft-delete false` to opt out.
- **Who can write?** `--writes admin|editor|any` selects the auth wrapper for the write routes (POST/PUT/DELETE):
  - `admin` → `withAdminAuth` (ADMIN only)
  - `editor` → `withEditorAuth` (ADMIN or EDITOR; rejects VIEWER)
  - `any` → `withAuth` (any authenticated user) — **default**
  - GET routes always use `withAuth`.
  - `--admin-writes true` is kept as a **back-compat alias** for `--writes admin`; `--writes` takes precedence if both are given.
- **Display field** for the recycling bin: `--display-field name` (default).

## Examples

Minimal scalar:
```
npm run scaffold -- --name Project --fields 'name:string,description:text?'
```

Full task-management slice:
```
npm run scaffold -- --name Task \
  --fields 'title:string,dueAt:date?' \
  --enums 'status:TODO|IN_PROGRESS|DONE,priority:LOW|MEDIUM|HIGH?' \
  --relations 'project:Project,assignee:User?'
```

HR record with required project ownership, admin-only writes:
```
npm run scaffold -- --name Employee \
  --fields 'fullName:string,joinDate:date' \
  --enums 'contractType:FULL_TIME|PART_TIME|CONTRACTOR' \
  --relations 'manager:User?' \
  --writes admin \
  --display-field fullName
```

Editor-writable entity (ADMIN or EDITOR can write; VIEWER is read-only):
```
npm run scaffold -- --name Article \
  --fields 'title:string,body:text' \
  --writes editor
```

## After scaffolding

1. Review the schema diff (`prisma/schema.prisma`) -- new model + any new enums + back-refs added to target models. Note the emitted `@@index` entries (see "What gets generated").
2. Run `npm run prisma:migrate -- --name add_<snake>`.
3. Run `npm run prisma:generate`.
4. **i18n merge (MANDATORY -- not optional).** The generated pages, columns, and form all call `useTranslations("<entityCamel>s")`. The scaffold does **not** edit the shared `messages/*.json` directly; instead it emits a companion file `messages/_scaffold-<kebab>.json` containing the single `<entityCamel>s` namespace with English defaults. You must:
   - Merge that namespace into **`messages/en.json`** (keep the English values).
   - Merge it into **`messages/ar.json`** as well, **translating** the values to Arabic (the companion seeds Arabic with the English text as a placeholder).
   - **Delete `messages/_scaffold-<kebab>.json`** once merged.
   Until you merge, the UI renders the **raw key strings** (e.g. `title`, `createdAt`, `save`) instead of labels. This step is required for the entity to be usable.
5. Suggest `/ship` or rely on CI to verify typecheck + lint + build pass.

## What gets generated

- `prisma/schema.prisma` -- new model + new enum blocks; back-refs patched into target models. The model emits `@@index` for: every indexed (`!`) scalar field, every relation FK (`<name>Id`), and (when soft-delete is on) `deletedAt` -- since the soft-delete extension filters `deletedAt: null` on every read.
- `lib/validations/<kebab>.ts` -- `create<Entity>Schema` + `update<Entity>Schema` (with `z.nativeEnum(...)` for enums). Relation FKs are intentionally omitted from the update schema (Prisma rejects direct FK assignment on `*UpdateInput` for required relations).
- `app/api/<kebab>/route.ts` -- GET list + POST create. The GET supports:
  - **Server-side pagination** (`parsePagination` + `paginatedResponse`).
  - **Server-side search** -- only when the entity has a string/text field: `?search=` does a case-insensitive `contains` on the first string/text field. No search support is emitted when the entity has no string-ish field.
  - **Server-side sort** -- `?sort=&order=` validated against a `SORTABLE_COLUMNS` allowlist (scalar fields + enum fields + `createdAt`) that guards against raw column injection. Defaults to `createdAt desc`.
  - The POST is wrapped `withRateLimit(<withAuth|withEditorAuth|withAdminAuth>(handler), { id: "<kebab>-write", limit: 30, windowMs: 60000 })` — the write wrapper is chosen by `--writes` (default `withAuth`).
- `app/api/<kebab>/[id]/route.ts` -- GET / PUT / DELETE. GET uses `withAuth`; PUT and DELETE use the `--writes` wrapper, each wrapped with the same `withRateLimit(..., { id: "<kebab>-write", limit: 30, windowMs: 60000 })`.
- `components/<kebab>/<Pascal>Columns.tsx` -- DataTable columns; enums rendered as colored Tags with filter dropdowns; relations rendered via traversal (`record.<name>?.<displayField>`). Column titles use i18n keys via `t(...)`. `sorter: true` is set on scalar/enum/`createdAt` columns and is now **server-driven** (wired to the GET route's `?sort=&order=` via the list page's `onSortChange`).
- `components/<kebab>/<Pascal>Form.tsx` -- Ant Form; scalar widgets per type; enum Select with hardcoded options. Relation fields use a **debounced searchable `RelationSelect`**: it seeds an initial page (`?pageSize=50`) on mount and re-queries the parent list route's `?search=` as the operator types (300ms debounce), so targets beyond the first page stay selectable -- it is **not** a fixed 100-row fetch. Labels use i18n keys via `t(...)`.
- `app/[locale]/(dashboard)/<kebab>/page.tsx` -- list page; wires a debounced search box (only when a string/text field exists), server-driven sort, and pagination into the GET route.
- `app/[locale]/(dashboard)/<kebab>/new/page.tsx` -- create page
- `app/[locale]/(dashboard)/<kebab>/[id]/page.tsx` -- edit page
- `messages/_scaffold-<kebab>.json` -- i18n companion holding the entity's `<entityCamel>s` namespace (field/enum/relation labels + fixed UI strings). **Must be merged into `messages/en.json` + `messages/ar.json` and then deleted** (see "After scaffolding" step 4). The generated UI uses these i18n keys, **not** the field names directly.

## What gets patched

- `lib/prisma/soft-delete-extension.ts` -- `SOFT_DELETE_MODELS` set
- `lib/prisma/recyclable.ts` -- `RECYCLABLE_ENTITY_TYPES` registry (the single source of truth read by both the list/restore and permanent-delete routes)
- `components/layout/AppSidebar.tsx` -- new nav item above `recycling-bin`
- `prisma/schema.prisma` -- target models gain back-ref fields for every relation pointing to them

## Hard rules preserved

- Every API handler wraps with `withAuth` / `withEditorAuth` / `withAdminAuth` -- never bare. GET uses `withAuth`; write handlers (POST/PUT/DELETE) use the `--writes` wrapper (default `withAuth`) and are additionally wrapped with `withRateLimit(..., { id: "<kebab>-write", limit: 30, windowMs: 60000 })`.
- Uses `prisma` (not `prismaUnfiltered`) so soft-deleted rows stay filtered on the entity itself. (Note: relation `include`s do not filter target soft-deletes -- a known Prisma-extension limitation. Hand-edit if needed.)
- zod parses request bodies before any Prisma call.
- snake_case `@@map` for the table name; camelCase Prisma fields; PascalCase model + enum types.
- The entity is **not** added to the audit `EXCLUDE` set -- writes are auto-audited.
- Relations are one-sided by default. Multiple relations from the same source to the same target need manual `@relation("<Name>", ...)` edits (Prisma's requirement).

## Do NOT

- Do NOT run `prisma migrate dev` automatically -- the user reviews the schema diff first.
- Do NOT add fields holding Restricted data (passwords, tokens, salaries, API keys) without first extending `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` AND `tests/contracts/audit-scrub.test.ts`. See SECURITY.md §5 + finding T-03.
- Do NOT add the entity to the audit `EXCLUDE` set.

## Idempotency

Refuses to overwrite an existing entity. Refuses if the model already exists in `schema.prisma`. To regenerate after a typo: delete the generated files, remove the schema model block + enum blocks + back-ref additions, then re-run.

## Multiple relations to the same target

The codegen handles each relation independently and adds one back-ref per relation. If you scaffold an entity with two relations to the same target (e.g. `Task` with both `createdBy:User` and `assignee:User`), Prisma will require explicit `@relation("Name", ...)` disambiguators that the codegen does NOT auto-write. Edit the schema by hand for the second relation before running the migration.
