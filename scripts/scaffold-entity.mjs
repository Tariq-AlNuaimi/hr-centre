#!/usr/bin/env node
// scripts/scaffold-entity.mjs
//
// Codegen for a new CRUD entity. Mirrors the User reference implementation
// across nine new files and patches four existing ones.
//
// Args:
//   --name <Pascal>                       Entity name in PascalCase (required)
//   --fields <spec>                       Scalar fields (comma-separated)
//                                         spec: name:type[?][!]
//                                         types: string|text|int|float|boolean|date|datetime|json
//                                         ? = optional, ! = indexed
//   --enums <spec>                        Enum fields (comma-separated)
//                                         spec: name:VAL1|VAL2|VAL3[?]
//                                         First value becomes the default unless ? is set
//   --relations <spec>                    Foreign-key relations (comma-separated)
//                                         spec: fieldName:TargetModel[?]
//                                         The target model must already exist in schema
//   --soft-delete <true|false>            Default true
//   --writes <admin|editor|any>           Auth wrapper for write routes (POST/PUT/DELETE).
//                                         admin  => withAdminAuth (ADMIN only)
//                                         editor => withEditorAuth (ADMIN or EDITOR)
//                                         any    => withAuth (any authenticated user)
//                                         Default "any". GET routes always use withAuth.
//   --admin-writes <true|false>           Back-compat alias. true => --writes admin.
//                                         --writes takes precedence if both are given.
//   --display-field <field>               For recycling bin display; default "name"
//   --dry-run
//
// Examples:
//   npm run scaffold -- --name Project --fields 'name:string,description:text?'
//   npm run scaffold -- --name Task --fields 'title:string,dueAt:date?' \
//     --enums 'status:TODO|IN_PROGRESS|DONE,priority:LOW|MEDIUM|HIGH?' \
//     --relations 'project:Project,assignee:User?'
//
// Stops before running the Prisma migration. Operator runs:
//   npm run prisma:migrate -- --name add_<snake>
//
// See .claude/skills/scaffold-entity/SKILL.md.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = process.cwd();

// ---------- CLI ----------

const { values } = parseArgs({
  options: {
    name: { type: 'string', short: 'n' },
    fields: { type: 'string', short: 'f' },
    enums: { type: 'string' },
    relations: { type: 'string' },
    'soft-delete': { type: 'string', default: 'true' },
    writes: { type: 'string' },
    'admin-writes': { type: 'string', default: 'false' },
    'display-field': { type: 'string', default: 'name' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.name) {
  console.error('ERROR: missing --name <PascalCase>');
  console.error('See `head -40 scripts/scaffold-entity.mjs` for usage.');
  process.exit(1);
}

const Entity = values.name;
if (!/^[A-Z][A-Za-z0-9]*$/.test(Entity)) {
  console.error(`ERROR: invalid name "${Entity}" -- must be PascalCase.`);
  process.exit(1);
}

const softDelete = values['soft-delete'] !== 'false';

// Write-route auth wrapper. `--writes` takes precedence; `--admin-writes` is a
// back-compat alias (true => admin). Default "any" preserves the historical
// default (no --admin-writes => withAuth).
const WRITE_WRAPPERS = {
  admin: 'withAdminAuth',
  editor: 'withEditorAuth',
  any: 'withAuth',
};
let writesMode;
if (values.writes !== undefined) {
  writesMode = values.writes;
  if (!Object.hasOwn(WRITE_WRAPPERS, writesMode)) {
    console.error(`ERROR: invalid --writes "${writesMode}" -- expected one of: ${Object.keys(WRITE_WRAPPERS).join(', ')}.`);
    process.exit(1);
  }
} else {
  writesMode = values['admin-writes'] === 'true' ? 'admin' : 'any';
}
const writeWrap = WRITE_WRAPPERS[writesMode];

// Import list for the API routes: GET uses withAuth (reads); write routes use
// the resolved writeWrap. Both are wrapped with withRateLimit. writeWrap is
// fixed for the run, so this is computed once and shared by both route files.
const wrapImports = ['withAuth', ...(writeWrap !== 'withAuth' ? [writeWrap] : []), 'withRateLimit'].join(', ');

const displayField = values['display-field'];
const dryRun = values['dry-run'];

// ---------- Name helpers ----------

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const pascalFromCamel = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const snake = (s) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
// "dueAt" -> "Due At", "name" -> "Name". Used to seed human-readable English
// defaults in the i18n namespace merged into messages/en.json + messages/ar.json.
const humanize = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());

const Pascal = Entity;
const entityCamel = camel(Entity);
const entityKebab = kebab(Entity);
const entitySnake = snake(Entity);
const entitySnakePlural = entitySnake + 's';
// next-intl namespace for this entity's UI strings. Mirrors the hand-written
// `users` namespace in messages/*.json (camelCase + plural).
const i18nNs = entityCamel + 's';

// ---------- Field parsing ----------

const FIELD_TYPES = {
  string: { prisma: 'String', zod: 'z.string().min(1)', ts: 'string', input: 'Input' },
  text: { prisma: 'String', zod: 'z.string()', ts: 'string', input: 'TextArea' },
  int: { prisma: 'Int', zod: 'z.coerce.number().int()', ts: 'number', input: 'InputNumber' },
  float: { prisma: 'Float', zod: 'z.coerce.number()', ts: 'number', input: 'InputNumber' },
  boolean: { prisma: 'Boolean', zod: 'z.boolean()', ts: 'boolean', input: 'Switch' },
  date: { prisma: 'DateTime', zod: 'z.coerce.date()', ts: 'string', input: 'DatePicker' },
  datetime: { prisma: 'DateTime', zod: 'z.coerce.date()', ts: 'string', input: 'DatePicker' },
  json: { prisma: 'Json', zod: 'z.any()', ts: 'unknown', input: 'TextArea' },
};

const FIELD_RE = /^(\w+):(\w+)(\??)(!?)$/;
const ENUM_RE = /^([a-z]\w*):([A-Z0-9_|]+)(\??)$/;
const RELATION_RE = /^(\w+):([A-Z]\w*)(\??)$/;

function parseField(spec) {
  const m = spec.match(FIELD_RE);
  if (!m) throw new Error(`Invalid field "${spec}" -- expected "name:type[?][!]".`);
  const [, name, type, opt, idx] = m;
  if (!FIELD_TYPES[type]) {
    throw new Error(`Unknown field type "${type}" in "${spec}". Known: ${Object.keys(FIELD_TYPES).join(', ')}.`);
  }
  // Json fields: always nullable. zod's z.any() is implicitly optional in
  // object schemas (zod quirk) -- Prisma's required-Json (InputJsonValue)
  // won't match the zod-inferred type. Forcing the Prisma side to Json?
  // aligns both sides. Hand-edit the schema afterward if you need
  // required-with-default behaviour (e.g. `Json @default("{}")`).
  const optional = opt === '?' || type === 'json';
  return { kind: 'scalar', name, type, optional, indexed: idx === '!' };
}

function parseEnum(spec) {
  const m = spec.match(ENUM_RE);
  if (!m) throw new Error(`Invalid enum "${spec}" -- expected "name:VAL1|VAL2|...[?]".`);
  const [, name, valuesRaw, opt] = m;
  const enumValues = valuesRaw.split('|').filter(Boolean);
  if (enumValues.length < 2) throw new Error(`Enum "${spec}" needs at least 2 values.`);
  return {
    kind: 'enum',
    name,
    enumName: Pascal + pascalFromCamel(name),
    values: enumValues,
    optional: opt === '?',
  };
}

function parseRelation(spec) {
  const m = spec.match(RELATION_RE);
  if (!m) throw new Error(`Invalid relation "${spec}" -- expected "fieldName:TargetModel[?]".`);
  const [, name, target, opt] = m;
  return { kind: 'relation', name, target, optional: opt === '?' };
}

const fields = (values.fields ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseField);
const enums = (values.enums ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseEnum);
const relations = (values.relations ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseRelation);

if (fields.length + enums.length + relations.length === 0) {
  console.error('ERROR: at least one of --fields / --enums / --relations is required.');
  process.exit(1);
}

// The list view can offer free-text search only if there is a string/text
// field to search against. Used by both the GET route and the list page.
const searchField = fields.find((f) => f.type === 'string' || f.type === 'text');

// ---------- Schema parsing (for target-model lookups) ----------

const schemaSrc = await readFile(join(ROOT, 'prisma/schema.prisma'), 'utf8');

function findModelBlock(src, modelName) {
  const re = new RegExp(`(model ${modelName}\\s*\\{)([\\s\\S]*?)(\\n\\})`, 'm');
  const m = src.match(re);
  if (!m) return null;
  return { header: m[1], body: m[2], footer: m[3], full: m[0], index: m.index };
}

function detectDisplayField(modelName) {
  const block = findModelBlock(schemaSrc, modelName);
  if (!block) return 'id';
  const candidates = ['name', 'title', 'label', 'email'];
  for (const cand of candidates) {
    if (new RegExp(`\\b${cand}\\s+String`, 'm').test(block.body)) return cand;
  }
  return 'id';
}

// Validate every relation target exists
for (const rel of relations) {
  if (!findModelBlock(schemaSrc, rel.target)) {
    console.error(`ERROR: relation target "${rel.target}" not found in prisma/schema.prisma.`);
    process.exit(1);
  }
  rel.displayField = detectDisplayField(rel.target);
  rel.targetKebab = kebab(rel.target);
}

// ---------- Idempotency check ----------

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

for (const p of [
  `app/api/${entityKebab}/route.ts`,
  `lib/validations/${entityKebab}.ts`,
  `components/${entityKebab}`,
]) {
  if (await pathExists(join(ROOT, p))) {
    console.error(`ERROR: ${p} already exists. Refusing to overwrite.`);
    process.exit(1);
  }
}

if (new RegExp(`^model ${Pascal}\\b`, 'm').test(schemaSrc)) {
  console.error(`ERROR: model ${Pascal} already exists in prisma/schema.prisma.`);
  process.exit(1);
}

// ---------- Schema generation ----------

function enumBlocks() {
  return enums.map((e) =>
    `\nenum ${e.enumName} {\n${e.values.map((v) => `  ${v}`).join('\n')}\n}\n`
  ).join('');
}

function schemaModelBlock() {
  const lines = ['', `model ${Pascal} {`, '  id        String   @id @default(cuid())'];

  for (const f of fields) {
    const type = FIELD_TYPES[f.type].prisma + (f.optional ? '?' : '');
    lines.push(`  ${f.name.padEnd(11)} ${type}`);
  }
  for (const e of enums) {
    const def = !e.optional ? ` @default(${e.values[0]})` : '';
    const type = e.enumName + (e.optional ? '?' : '');
    lines.push(`  ${e.name.padEnd(11)} ${type}${def}`);
  }
  for (const r of relations) {
    const fkType = 'String' + (r.optional ? '?' : '');
    lines.push(`  ${(r.name + 'Id').padEnd(11)} ${fkType}`);
    const relType = r.target + (r.optional ? '?' : '');
    lines.push(`  ${r.name.padEnd(11)} ${relType} @relation(fields: [${r.name}Id], references: [id])`);
  }

  lines.push('  createdAt DateTime @default(now())');
  lines.push('  updatedAt DateTime @updatedAt');
  if (softDelete) {
    lines.push('  deletedAt DateTime?');
    lines.push('  deletedBy String?');
  }

  for (const f of fields.filter((x) => x.indexed)) lines.push(`  @@index([${f.name}])`);
  for (const r of relations) lines.push(`  @@index([${r.name}Id])`);
  // The soft-delete extension filters `deletedAt: null` on every read, and the
  // default list sort is `createdAt desc`; one composite index serves both (the
  // `deletedAt` prefix covers the filter). Mirrors the base User model.
  if (softDelete) lines.push('  @@index([deletedAt, createdAt])');

  lines.push(`  @@map("${entitySnakePlural}")`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function patchedTargetModels(src) {
  // For each relation, add a back-ref to the target model if missing.
  // Back-ref shape: `<sourceEntityCamel>s <SourceEntity>[]`.
  let out = src;
  for (const r of relations) {
    const backRefField = entityCamel + 's';
    const block = findModelBlock(out, r.target);
    if (!block) continue; // already validated; defensive
    if (new RegExp(`\\b${backRefField}\\s+${Pascal}\\[\\]`, 'm').test(block.body)) continue;
    const newBody = block.body.replace(/(\n\s*@@\w|\s*$)/, (match) =>
      `\n  ${backRefField.padEnd(11)} ${Pascal}[]${match}`
    );
    out = out.replace(block.full, block.header + newBody + block.footer);
  }
  return out;
}

// ---------- File templates ----------

function validationFile() {
  const enumImports = enums.length === 0
    ? ''
    : `import { ${enums.map((e) => e.enumName).join(', ')} } from "../../generated/prisma/client";\n\n`;

  function zodFor(f) {
    let z = FIELD_TYPES[f.type].zod;
    if (f.type === 'string') z += '.max(255)';
    return z;
  }

  const createLines = [
    ...fields.map((f) => `  ${f.name}: ${zodFor(f)}${f.optional ? '.optional()' : ''},`),
    ...enums.map((e) => `  ${e.name}: z.nativeEnum(${e.enumName})${e.optional ? '.optional()' : ''},`),
    ...relations.map((r) => `  ${r.name}Id: z.string().min(1)${r.optional ? '.optional()' : ''},`),
  ].join('\n');

  const updateLines = [
    ...fields.map((f) => `  ${f.name}: ${zodFor(f)}.optional(),`),
    ...enums.map((e) => `  ${e.name}: z.nativeEnum(${e.enumName}).optional(),`),
    // Relation FKs are intentionally omitted from update schemas: Prisma's
    // *UpdateInput rejects direct FK assignment for required relations
    // (must go through { connect: { id } }). Callers that need to reparent
    // should do so explicitly in the route handler.
  ].join('\n');

  return `import { z } from "zod";
${enumImports}export const create${Pascal}Schema = z.object({
${createLines}
});

export const update${Pascal}Schema = z.object({
${updateLines}
});

export type Create${Pascal}Input = z.infer<typeof create${Pascal}Schema>;
export type Update${Pascal}Input = z.infer<typeof update${Pascal}Schema>;
`;
}

function apiListRouteFile() {
  // Search uses the first string/text field, optional or not (shared
  // `searchField`). If the model has no string-ish field, there's nothing to
  // search and the list page omits the search box (no `searchable`).
  const searchClause = searchField
    ? `
  const search = searchParams.get("search") ?? undefined;
  const where = search
    ? { ${searchField.name}: { contains: search, mode: "insensitive" as const } }
    : {};
`
    : `
  const where = {};
`;

  // Sortable allowlist: scalar + enum fields + createdAt. Guards against raw
  // column injection via ?sort=. Relations are not directly sortable here.
  const sortableNames = [
    ...fields.map((f) => f.name),
    ...enums.map((e) => e.name),
    'createdAt',
  ];

  const includeClause = relations.length === 0
    ? ''
    : `
      include: {
${relations.map((r) => `        ${r.name}: { select: ${r.displayField === 'id' ? '{ id: true }' : `{ id: true, ${r.displayField}: true }`} },`).join('\n')}
      },`;

  return `import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ${wrapImports} } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { create${Pascal}Schema } from "@/lib/validations/${entityKebab}";

// Allowlist of sortable columns -- prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = [
${sortableNames.map((n) => `  "${n}",`).join('\n')}
] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const GET = withRateLimit(withAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);
${searchClause}
  const sortParam = searchParams.get("sort");
  const sortField: SortableColumn =
    sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
      ? (sortParam as SortableColumn)
      : "createdAt";
  const order: "asc" | "desc" =
    searchParams.get("order") === "asc" ? "asc" : "desc";

  const [data, total] = await Promise.all([
    prisma.${entityCamel}.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: order },${includeClause}
    }),
    prisma.${entityCamel}.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
}), { id: "${entityKebab}-read", limit: 120, windowMs: 60000 });

export const POST = withRateLimit(${writeWrap}(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = create${Pascal}Schema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const ${entityCamel} = await prisma.${entityCamel}.create({ data: parsed.data });

  return created(${entityCamel});
}), { id: "${entityKebab}-write", limit: 30, windowMs: 60000 });
`;
}

function apiItemRouteFile() {
  const includeClause = relations.length === 0
    ? ''
    : ` include: {
${relations.map((r) => `      ${r.name}: { select: ${r.displayField === 'id' ? '{ id: true }' : `{ id: true, ${r.displayField}: true }`} },`).join('\n')}
    },`;

  return `import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ${wrapImports} } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { update${Pascal}Schema } from "@/lib/validations/${entityKebab}";

export const GET = withRateLimit(withAuth(async (_request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const record = await prisma.${entityCamel}.findUnique({ where: { id },${includeClause} });
  if (!record) return notFound("${Pascal}");
  return ok(record);
}), { id: "${entityKebab}-read", limit: 120, windowMs: 60000 });

export const PUT = withRateLimit(${writeWrap}(async (request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = update${Pascal}Schema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const existing = await prisma.${entityCamel}.findUnique({ where: { id } });
  if (!existing) return notFound("${Pascal}");
  const updated = await prisma.${entityCamel}.update({
    where: { id },
    data: parsed.data,
  });
  return ok(updated);
}), { id: "${entityKebab}-write", limit: 30, windowMs: 60000 });

export const DELETE = withRateLimit(${writeWrap}(async (_request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.${entityCamel}.findUnique({ where: { id } });
  if (!existing) return notFound("${Pascal}");
  await prisma.${entityCamel}.delete({ where: { id } });
  return ok({ id });
}), { id: "${entityKebab}-write", limit: 30, windowMs: 60000 });
`;
}

function recordTypeFields() {
  return [
    ...fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}${f.optional ? ' | null' : ''}`),
    ...enums.map((e) => `${e.name}${e.optional ? '?' : ''}: ${e.values.map((v) => `"${v}"`).join(' | ')}${e.optional ? ' | null' : ''}`),
    ...relations.flatMap((r) => [
      `${r.name}Id${r.optional ? '?' : ''}: string${r.optional ? ' | null' : ''}`,
      `${r.name}${r.optional ? '?' : ''}: { ${r.displayField === 'id' ? 'id: string' : `id: string; ${r.displayField}: string | null`} }${r.optional ? ' | null' : ''}`,
    ]),
  ];
}

function columnsFile() {
  const recordType = `{ id: string; ${recordTypeFields().join('; ')}; createdAt: string; }`;
  // Round-robin over the shared Badge tones (was the AntD Tag color list). Since
  // scaffolded enum values are arbitrary, we cycle rather than semantically map.
  const BADGE_VARIANTS = ['brand', 'success', 'warning', 'danger', 'default'];

  // Date/datetime scalars render as locale dates; everything else uses the
  // default cell renderer. `sorter: true` is server-driven (see the GET route's
  // SORTABLE_COLUMNS allowlist + onSortChange wiring on the list page).
  const scalarCols = fields.map((f) => {
    const render = (f.type === 'date' || f.type === 'datetime')
      ? `
      render: (val: string | null) => (val ? new Date(val).toLocaleDateString() : "-"),`
      : '';
    return `    {
      title: t("${f.name}"),
      dataIndex: "${f.name}",
      key: "${f.name}",
      sorter: true,${render}
    },`;
  });

  const enumCols = enums.map((e) => `    {
      title: t("${e.name}"),
      dataIndex: "${e.name}",
      key: "${e.name}",
      sorter: true,
      render: (val: string | null) => {
        if (!val) return "-";
        return <Badge variant={tone[val] ?? "default"}>{val}</Badge>;
      },
      filters: [${e.values.map((v) => `{ text: "${v}", value: "${v}" }`).join(', ')}],
      filterMultiple: false,
    },`);

  const relationCols = relations.map((r) => `    {
      title: t("${r.name}"),
      key: "${r.name}",
      render: (_: unknown, record: ${Pascal}Record) => record.${r.name}?.${r.displayField} ?? "-",
    },`);

  const usesBadge = enums.length > 0;
  const badgeImports = usesBadge
    ? `import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
`
    : '';

  // Enum value -> Badge tone map, round-robin over the available variants.
  const toneEntries = enums
    .flatMap((e) => e.values)
    .map((v, i) => `"${v}": "${BADGE_VARIANTS[i % BADGE_VARIANTS.length]}"`)
    .join(', ');
  const toneConst = usesBadge
    ? `
const tone: Record<string, BadgeProps["variant"]> = { ${toneEntries} };
`
    : '';

  return `"use client";

import { Button } from "@/components/ui/button";
${badgeImports}import { ConfirmAction } from "@/components/shared/ConfirmAction";

export interface ${Pascal}Record ${recordType}
${toneConst}
function EditIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// The returned column objects are DataTable-shaped (title/dataIndex/render/
// sorter/filters); the rebuilt DataTable consumes that shape at runtime and
// converts it to tanstack ColumnDefs internally. The shape is left to inference
// so this file carries no table-library import.
export function get${Pascal}Columns({
  onEdit,
  onDelete,
  t,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  return [
${[...scalarCols, ...enumCols, ...relationCols].join('\n')}
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_: unknown, record: ${Pascal}Record) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("editAction")}
            onClick={() => onEdit(record.id)}
          >
            <EditIcon />
          </Button>
          <ConfirmAction title={t("deleteConfirm")} onConfirm={() => onDelete(record.id)}>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              aria-label={t("deleteAction")}
            >
              <DeleteIcon />
            </Button>
          </ConfirmAction>
        </div>
      ),
    },
  ];
}
`;
}

function formFile() {
  // --- zod schema field expressions (mirror the API-boundary validation) ---
  const scalarZod = (f) => {
    let base;
    switch (f.type) {
      case 'int': base = 'z.coerce.number().int()'; break;
      case 'float': base = 'z.coerce.number()'; break;
      case 'boolean': base = 'z.boolean()'; break;
      case 'date':
      case 'datetime': base = f.optional ? 'z.string()' : 'z.string().min(1)'; break;
      case 'json': base = 'z.any()'; break;
      case 'text': base = 'z.string()'; break;
      default: base = f.optional ? 'z.string()' : 'z.string().min(1)'; break; // string
    }
    // json is inherently optional in a zod object (z.any); don't double it up.
    if (f.optional && f.type !== 'json') base += '.nullish()';
    return `    ${f.name}: ${base},`;
  };

  const schemaLines = [
    ...fields.map(scalarZod),
    ...enums.map((e) => {
      const en = `z.enum([${e.values.map((v) => `"${v}"`).join(', ')}])`;
      return `    ${e.name}: ${en}${e.optional ? '.nullish()' : ''},`;
    }),
    ...relations.map((r) => `    ${r.name}Id: ${r.optional ? 'z.string().nullish()' : 'z.string().min(1)'},`),
  ];

  // --- defaultValues (coalesce nulls to controlled-input-friendly seeds) ---
  const defaultLines = [
    ...fields.map((f) => {
      if (f.type === 'boolean') return `      ${f.name}: initialValues?.${f.name} ?? false,`;
      if (f.type === 'int' || f.type === 'float') return `      ${f.name}: initialValues?.${f.name} ?? undefined,`;
      return `      ${f.name}: initialValues?.${f.name} ?? "",`;
    }),
    ...enums.map((e) =>
      e.optional
        ? `      ${e.name}: initialValues?.${e.name} ?? undefined,`
        : `      ${e.name}: initialValues?.${e.name} ?? "${e.values[0]}",`,
    ),
    ...relations.map((r) => `      ${r.name}Id: initialValues?.${r.name}Id ?? undefined,`),
  ];

  // --- field JSX ---
  const scalarItems = fields.map((f) => {
    if (f.type === 'boolean') {
      return `        <FormField
          name="${f.name}"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("${f.name}")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />`;
    }
    const typeAttr =
      f.type === 'int' || f.type === 'float' ? ' type="number"'
      : f.type === 'date' || f.type === 'datetime' ? ' type="date"'
      : '';
    return `        <TextField name="${f.name}" label={t("${f.name}")}${typeAttr} />`;
  });

  const enumItems = enums.map((e) => `        <FormField
          name="${e.name}"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("${e.name}")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("${e.name}")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
${e.values.map((v) => `                  <SelectItem value="${v}">${v}</SelectItem>`).join('\n')}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />`);

  const relationItems = relations.map((r) => `        <FormField
          name="${r.name}Id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("${r.name}")}</FormLabel>
              <RelationSelect
                path="/api/${r.targetKebab}"
                displayField="${r.displayField}"
                placeholder={t("${r.name}")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={field.onChange}
              />
              <FormMessage />
            </FormItem>
          )}
        />`);

  // Form value type aligns with the Record type from columnsFile: optional
  // scalars include `| null` so the edit page's Prisma row shape (where optional
  // fields can be null) maps into the form's defaultValues directly.
  const valueTypeParts = [
    ...fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}${f.optional ? ' | null' : ''}`),
    ...enums.map((e) => `${e.name}${e.optional ? '?' : ''}: ${e.values.map((v) => `"${v}"`).join(' | ')}${e.optional ? ' | null' : ''}`),
    ...relations.map((r) => `${r.name}Id${r.optional ? '?' : ''}: string${r.optional ? ' | null' : ''}`),
  ];
  const valueType = `{ ${valueTypeParts.join('; ')} }`;

  // --- imports (only what the emitted fields actually reference) ---
  const hasTextField = fields.some((f) => f.type !== 'boolean');
  const hasSwitch = fields.some((f) => f.type === 'boolean');
  const hasFormPrimitives = hasSwitch || enums.length > 0 || relations.length > 0;
  const hasSelect = enums.length > 0; // enums use Select; relations use a Popover combobox
  const hasPopover = relations.length > 0;

  const fieldFieldImport = hasTextField
    ? 'import { useZodForm, Form, TextField } from "@/components/shared/FormField";'
    : 'import { useZodForm, Form } from "@/components/shared/FormField";';
  const formPrimitiveImport = hasFormPrimitives
    ? `import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
`
    : '';
  const selectImport = hasSelect
    ? `import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
`
    : '';
  const switchImport = hasSwitch ? 'import { Switch } from "@/components/ui/switch";\n' : '';
  const popoverImport = hasPopover
    ? `import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
`
    : '';
  const reactImport = relations.length === 0 ? '' : 'import { useEffect, useRef, useState } from "react";\n';

  // Relation targets can exceed one page, so RelationSelect is a searchable
  // combobox: a Popover holding a debounced server-side search box + the matching
  // rows as plain <button>s, so any target row is reachable by typing (not just the
  // first 50). Deliberately NOT a Radix Select-with-search: a Select's content is a
  // role="listbox" that only permits option children (a raw <input> trips axe
  // aria-required-children) and traps Tab + auto-focuses an item, leaving a search
  // box keyboard-unreachable. Plain buttons in a Popover are focusable + valid;
  // Radix owns focus/Escape/positioning. /api/<target> honors ?search= when the
  // target is searchable (ignored otherwise, so it's safe for every target).
  const relationSelectComponent = relations.length === 0 ? '' : `
function RelationSelect({
  path,
  displayField,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  value,
  onChange,
}: {
  path: string;
  displayField: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Debounce so a keystroke doesn't fire a request per character. Empty query
    // seeds the initial page; a non-empty one narrows server-side.
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ pageSize: "50" });
      if (search) qs.set("search", search);
      fetch(path + "?" + qs.toString())
        .then((r) => r.json())
        .then((j: { data?: { data?: Array<{ id: string } & Record<string, unknown>> } }) => {
          const opts = (j.data?.data ?? []).map((row) => ({
            value: row.id,
            label: (row[displayField] as string | undefined) ?? row.id,
          }));
          setOptions(opts);
          // Keep the trigger label resolvable even after the list is filtered.
          const match = opts.find((o) => o.value === value);
          if (match) setSelectedLabel(match.label);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [path, displayField, search, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FormControl>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
          >
            <span className={value ? "" : "text-muted-foreground"}>
              {selectedLabel ?? placeholder}
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 flex-none opacity-60"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
            </svg>
          </Button>
        </PopoverTrigger>
      </FormControl>
      <PopoverContent
        align="start"
        // Focus the search box (not an option) when the popover opens.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        className="w-[var(--radix-popover-trigger-width)] p-1"
      >
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="mb-1 w-full rounded-sm border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="max-h-56 overflow-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange?.(o.value);
                  setSelectedLabel(o.label);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring " +
                  (o.value === value ? "font-medium text-primary-emphasis" : "text-foreground")
                }
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
`;

  return `"use client";

${reactImport}import { z } from "zod";
import { useTranslations } from "next-intl";
${fieldFieldImport}
${formPrimitiveImport}${selectImport}${popoverImport}${switchImport}import { Button } from "@/components/ui/button";

interface ${Pascal}FormProps {
  initialValues?: Partial<${valueType}>;
  onSubmit: (values: ${valueType}) => void;
  onCancel: () => void;
  loading?: boolean;
}
${relationSelectComponent}
export function ${Pascal}Form({ initialValues, onSubmit, onCancel, loading = false }: ${Pascal}FormProps) {
  const t = useTranslations("${i18nNs}");

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
${schemaLines.join('\n')}
  });

  const form = useZodForm(schema, {
    defaultValues: {
${defaultLines.join('\n')}
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex max-w-[500px] flex-col gap-4"
      >
${[...scalarItems, ...enumItems, ...relationItems].join('\n\n')}

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
`;
}

function listPageFile() {
  const searchState = searchField ? '\n  const [search, setSearch] = useState("");' : '';
  const searchParam = searchField ? '\n    ...(search ? { search } : {}),' : '';
  const searchProps = searchField
    ? `
        searchable
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}`
    : '';

  return `"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { get${Pascal}Columns, type ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";
import { useEntityList, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";

function PlusIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export default function ${Pascal}sPage() {
  const t = useTranslations("${i18nNs}");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);${searchState}
  const [sort, setSort] = useState<SortChange>({});

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),${searchParam}
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
  };

  // Declarative data layer (ADR-021): the query caches + keeps the previous page
  // visible while a new page/search/sort loads, and the delete mutation
  // invalidates the list so it refetches itself -- no manual fetch/setState.
  // Read failures toast via the QueryProvider's cache-level onError (the message
  // passed here), so we don't hand-roll an error effect per page.
  const { data, isLoading } = useEntityList<${Pascal}Record>("/api/${entityKebab}", params, t("loadFailed"));
  const { remove } = useEntityMutations<${Pascal}Record>("/api/${entityKebab}");

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      success(t("deleted"));
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = get${Pascal}Columns({
    onEdit: (id) => router.push(\`/\${locale}/${entityKebab}/\${id}\`),
    onDelete: handleDelete,
    t,
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => router.push(\`/\${locale}/${entityKebab}/new\`)}>
            <PlusIcon />
            {t("createNew")}
          </Button>
        }
      />
      <DataTable<${Pascal}Record>
        columns={columns}
        dataSource={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}${searchProps}
        emptyText={<EmptyState actionLabel={t("createNew")} onAction={() => router.push(\`/\${locale}/${entityKebab}/new\`)} />}
      />
    </>
  );
}
`;
}

function newPageFile() {
  return `"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ${Pascal}Form } from "@/components/${entityKebab}/${Pascal}Form";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";

export default function New${Pascal}Page() {
  const t = useTranslations("${i18nNs}");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<${Pascal}Record>("/api/${entityKebab}");

  const handleSubmit = async (values: Partial<${Pascal}Record>) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(\`/\${locale}/${entityKebab}\`);
    } catch {
      showError(t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createNew")} />
      <${Pascal}Form
        onSubmit={handleSubmit}
        onCancel={() => router.push(\`/\${locale}/${entityKebab}\`)}
        loading={create.isPending}
      />
    </>
  );
}
`;
}

function editPageFile() {
  return `"use client";

import { useRouter, useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ${Pascal}Form } from "@/components/${entityKebab}/${Pascal}Form";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import type { ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";

export default function Edit${Pascal}Page() {
  const t = useTranslations("${i18nNs}");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  // Read failure toasts via the QueryProvider cache-level onError (message here).
  const { data: record, isLoading } = useEntityItem<${Pascal}Record>("/api/${entityKebab}", params?.id, t("loadFailed"));
  const { update } = useEntityMutations<${Pascal}Record>("/api/${entityKebab}");

  const handleSubmit = async (values: Partial<${Pascal}Record>) => {
    if (!params?.id) return;
    try {
      await update.mutateAsync({ id: params.id, data: values });
      success(t("updated"));
      router.push(\`/\${locale}/${entityKebab}\`);
    } catch {
      showError(t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (!record) return null;

  return (
    <>
      <PageHeader title={t("editTitle")} />
      <${Pascal}Form
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(\`/\${locale}/${entityKebab}\`)}
        loading={update.isPending}
      />
    </>
  );
}
`;
}

// next-intl namespace: the generated pages/forms/columns all call
// useTranslations("<i18nNs>"). We merge this entity's namespace directly into
// BOTH messages/en.json and messages/ar.json (see mergeMessages below). English
// values double as the Arabic placeholders until an operator translates them, so
// the two files stay in exact key parity.
function entityMessageKeys() {
  const keys = {};
  // Field / enum / relation labels (column headers + form labels).
  for (const f of fields) keys[f.name] = humanize(f.name);
  for (const e of enums) keys[e.name] = humanize(e.name);
  for (const r of relations) keys[r.name] = humanize(r.name);
  // Fixed UI strings used by the generated columns/form/pages.
  keys.title = `${Pascal}s`;
  keys.createNew = `New ${Pascal}`;
  keys.editTitle = `Edit ${Pascal}`;
  keys.createdAt = 'Created';
  keys.save = 'Save';
  keys.cancel = 'Cancel';
  keys.editAction = `Edit ${entityCamel}`;
  keys.deleteAction = `Delete ${entityCamel}`;
  keys.deleteConfirm = `Are you sure you want to delete this ${entityCamel}?`;
  keys.loadFailed = `Failed to load ${i18nNs}`;
  keys.deleted = `${Pascal} deleted`;
  keys.deleteFailed = `Failed to delete ${entityCamel}`;
  keys.created = `${Pascal} created`;
  keys.createFailed = `Failed to create ${entityCamel}`;
  keys.updated = `${Pascal} updated`;
  keys.updateFailed = `Failed to update ${entityCamel}`;
  // Relation-picker search box (RelationSelect) — only referenced when the entity
  // has relations, but emitting them unconditionally keeps the namespace stable.
  if (relations.length) {
    keys.searchRelation = 'Search…';
    keys.noRelationMatches = 'No matches';
  }
  return keys;
}

// Merge the entity namespace into an existing messages file's parsed object,
// returning the serialized JSON (2-space + trailing newline, matching the
// existing files). Idempotent: if the namespace already exists, the file is
// returned byte-for-byte unchanged so a re-scaffold can't duplicate keys.
function mergeMessages(src, namespace, keys) {
  const parsed = JSON.parse(src);
  if (Object.hasOwn(parsed, namespace)) {
    // Namespace already present -- leave the file exactly as-is (don't reflow
    // formatting or clobber existing/translated values).
    return src;
  }
  parsed[namespace] = keys;
  return JSON.stringify(parsed, null, 2) + '\n';
}

// ---------- Existing-file patches ----------

async function patchSoftDeleteRegistry() {
  if (!softDelete) return null;
  const path = join(ROOT, 'lib/prisma/soft-delete-extension.ts');
  const src = await readFile(path, 'utf8');
  const re = /const SOFT_DELETE_MODELS = new Set\(\[([^\]]*)\]\);/;
  const m = src.match(re);
  if (!m) throw new Error('Could not locate SOFT_DELETE_MODELS.');
  const existing = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (existing.includes(`"${Pascal}"`)) return null;
  const updated = [...existing, `"${Pascal}"`].join(', ');
  return { path, content: src.replace(re, `const SOFT_DELETE_MODELS = new Set([${updated}]);`) };
}

async function patchRecyclingBin() {
  if (!softDelete) return null;
  // The recyclable allowlist is the single source of truth in
  // lib/prisma/recyclable.ts (both the list/restore and permanent-delete routes
  // read it). Register the new entity there.
  const path = join(ROOT, 'lib/prisma/recyclable.ts');
  const src = await readFile(path, 'utf8');
  if (src.includes(`${Pascal}: { displayField`)) return null;
  const marker = '  // Add more entity types here as you create them:';
  if (!src.includes(marker)) throw new Error('Could not locate RECYCLABLE_ENTITY_TYPES marker.');
  const insertion = `  ${Pascal}: { displayField: "${displayField}" },\n`;
  return { path, content: src.replace(marker, insertion + marker) };
}

async function patchSidebar() {
  const path = join(ROOT, 'components/layout/AppSidebar.tsx');
  const src = await readFile(path, 'utf8');
  if (src.includes(`key: "${entityKebab}"`)) return null;

  // The migrated AppSidebar (ADR-029) renders a plain <nav> of nav-items with
  // lucide icons and a `--nav-active-foreground` active state; each entry is a
  // `{ key, icon, label, onClick }` object (icon is a sized lucide element;
  // navigation is `router.push`, matching the recycling-bin item). Insert the
  // scaffolded entity's entry immediately before the recycling-bin nav item
  // (admin-gated, always present), matching that object's indentation so the
  // array stays well-formed.
  //
  // Check whether LayoutGrid is already in the lucide-react import block BEFORE
  // inserting the entry, because the entry itself contains `<LayoutGrid />` and
  // would otherwise pollute a file-wide search for the identifier.
  const importMatch = src.match(/import\s+\{([^}]*)\}\s+from\s+"lucide-react";/);
  const alreadyImported = importMatch && /\bLayoutGrid\b/.test(importMatch[1]);

  const anchor = src.match(/([ \t]*)\{[ \t]*\n[ \t]*key: "recycling-bin",/);
  if (!anchor) throw new Error('Could not locate recycling-bin nav entry.');
  const indent = anchor[1];
  const inner = indent + '  ';
  const insertion =
    `${indent}{\n` +
    `${inner}key: "${entityKebab}",\n` +
    `${inner}icon: <LayoutGrid className="h-4 w-4" />,\n` +
    `${inner}label: "${Pascal}s",\n` +
    `${inner}onClick: () => router.push(\`/\${locale}/${entityKebab}\`),\n` +
    `${indent}},\n`;
  let out = src.replace(anchor[0], insertion + anchor[0]);

  if (!alreadyImported) {
    out = out.replace(
      /(\}\s*from "lucide-react";)/,
      '  LayoutGrid,\n$1'
    );
  }
  return { path, content: out };
}

// ---------- Execute ----------

const writes = [];
const write = (relPath, content) => writes.push({ path: join(ROOT, relPath), content });

write(`lib/validations/${entityKebab}.ts`, validationFile());
write(`app/api/${entityKebab}/route.ts`, apiListRouteFile());
write(`app/api/${entityKebab}/[id]/route.ts`, apiItemRouteFile());
write(`components/${entityKebab}/${Pascal}Columns.tsx`, columnsFile());
write(`components/${entityKebab}/${Pascal}Form.tsx`, formFile());
write(`app/[locale]/(dashboard)/${entityKebab}/page.tsx`, listPageFile());
write(`app/[locale]/(dashboard)/${entityKebab}/new/page.tsx`, newPageFile());
write(`app/[locale]/(dashboard)/${entityKebab}/[id]/page.tsx`, editPageFile());

// ---------- All-or-nothing patch computation ----------
//
// The three patch helpers (soft-delete registry, recycling bin, sidebar) throw
// if their marker is missing in the target file. We compute EVERY patch here,
// BEFORE writing a single file. If any precondition fails, we exit having
// written nothing -- otherwise a marker that disappears mid-run would leave a
// half-scaffolded repo that the idempotency guard above then refuses to retry.
//
// Schema patch: enums + model + target back-refs.
let patches;
try {
  const schemaPatched = patchedTargetModels(schemaSrc) + enumBlocks() + schemaModelBlock();
  const schemaWrite = { path: join(ROOT, 'prisma/schema.prisma'), content: schemaPatched };

  // i18n: merge this entity's namespace into BOTH messages/en.json and
  // messages/ar.json. English values seed both (the ar copy is a placeholder an
  // operator translates later) -- parity stays exact. Idempotent: if the
  // namespace already exists, mergeMessages returns the file unchanged, so a
  // re-scaffold can't duplicate keys. Computed here (before any write) so the
  // all-or-nothing semantics hold: a malformed/missing messages file aborts the
  // whole run rather than leaving a half-scaffolded repo.
  const messageKeys = entityMessageKeys();
  const enPath = join(ROOT, 'messages/en.json');
  const arPath = join(ROOT, 'messages/ar.json');
  // These five reads are mutually independent, so fetch them concurrently.
  const [enSrc, arSrc, softDeletePatch, recyclingPatch, sidebarPatch] = await Promise.all([
    readFile(enPath, 'utf8'),
    readFile(arPath, 'utf8'),
    patchSoftDeleteRegistry(),
    patchRecyclingBin(),
    patchSidebar(),
  ]);
  const enWrite = { path: enPath, content: mergeMessages(enSrc, i18nNs, messageKeys) };
  const arWrite = { path: arPath, content: mergeMessages(arSrc, i18nNs, messageKeys) };

  patches = [schemaWrite, enWrite, arWrite, softDeletePatch, recyclingPatch, sidebarPatch].filter(Boolean);
} catch (e) {
  console.error(`ERROR: precondition failed -- ${e.message}`);
  console.error('Nothing was written. Restore the missing marker in the target file and re-run.');
  process.exit(1);
}

if (dryRun) {
  console.log('--- DRY RUN ---');
  for (const w of writes) console.log(`would write ${w.path} (${w.content.length} bytes)`);
  for (const p of patches) console.log(`would patch ${p.path}`);
  process.exit(0);
}

for (const w of writes) {
  await mkdir(dirname(w.path), { recursive: true });
  await writeFile(w.path, w.content);
  console.log(`+ ${w.path}`);
}
for (const p of patches) {
  await writeFile(p.path, p.content);
  console.log(`~ ${p.path}`);
}

console.log('');
console.log(`Scaffolded ${Pascal}. Next steps:`);
if (relations.length > 0) {
  console.log(`  > Relations declared: ${relations.map((r) => `${r.name} -> ${r.target}`).join(', ')}`);
  console.log('    Back-refs added to target models.');
}
if (enums.length > 0) {
  console.log(`  > Enums declared: ${enums.map((e) => `${e.enumName} (${e.values.join('|')})`).join(', ')}`);
}
console.log(`  1. Review prisma/schema.prisma (new model + enums + back-refs).`);
console.log(`  2. Run: npm run prisma:migrate -- --name add_${entitySnake}`);
console.log(`  3. Run: npm run prisma:generate`);
console.log('  4. i18n: the "' + i18nNs + '" namespace was merged into BOTH');
console.log('     messages/en.json and messages/ar.json (English text seeds both).');
console.log('     Translate the new "' + i18nNs + '" values in messages/ar.json.');
console.log(`  5. Commit; CI verifies build + lint + typecheck.`);
