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
  - Detects the target's display field automatically (`name` > `title` > `label` > `email` > `id`)
- **Soft-delete?** Default yes. Pass `--soft-delete false` to opt out.
- **Admin-only writes?** Default no. Pass `--admin-writes true` to wrap POST/PUT/DELETE with `withAdminAuth`.
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
  --admin-writes true \
  --display-field fullName
```

## After scaffolding

1. Review the schema diff (`prisma/schema.prisma`) -- new model + any new enums + back-refs added to target models.
2. Run `npm run prisma:migrate -- --name add_<snake>`.
3. Run `npm run prisma:generate`.
4. (Optional) Add i18n keys to `messages/en.json` + `messages/ar.json` if you want translated labels instead of the field names. Default generated UI uses the field names directly.
5. Suggest `/ship` or rely on CI to verify typecheck + lint + build pass.

## What gets generated

- `prisma/schema.prisma` -- new model + new enum blocks; back-refs patched into target models
- `lib/validations/<kebab>.ts` -- `create<Entity>Schema` + `update<Entity>Schema` (with `z.nativeEnum(...)` for enums)
- `app/api/<kebab>/route.ts` -- GET list (with `include` for relations) + POST create
- `app/api/<kebab>/[id]/route.ts` -- GET / PUT / DELETE
- `components/<kebab>/<Pascal>Columns.tsx` -- DataTable columns; enums rendered as colored Tags with filter dropdowns; relations rendered via traversal (`record.<name>?.<displayField>`)
- `components/<kebab>/<Pascal>Form.tsx` -- Ant Form; scalar widgets per type; enum Select with hardcoded options; relation Select fetching `/api/<target-kebab>?pageSize=100` and showing `displayField`
- `app/[locale]/(dashboard)/<kebab>/page.tsx` -- list page
- `app/[locale]/(dashboard)/<kebab>/new/page.tsx` -- create page
- `app/[locale]/(dashboard)/<kebab>/[id]/page.tsx` -- edit page

## What gets patched

- `lib/prisma/soft-delete-extension.ts` -- `SOFT_DELETE_MODELS` set
- `app/api/recycling-bin/route.ts` -- `ENTITY_TYPES` registry
- `components/layout/AppSidebar.tsx` -- new nav item above `recycling-bin`
- `prisma/schema.prisma` -- target models gain back-ref fields for every relation pointing to them

## Hard rules preserved

- Every API handler wraps with `withAuth` / `withAdminAuth` -- never bare.
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
