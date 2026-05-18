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
//   --admin-writes <true|false>           Default false
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
const adminWrites = values['admin-writes'] === 'true';
const displayField = values['display-field'];
const dryRun = values['dry-run'];

// ---------- Name helpers ----------

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const pascalFromCamel = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const snake = (s) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

const Pascal = Entity;
const entityCamel = camel(Entity);
const entityKebab = kebab(Entity);
const entitySnake = snake(Entity);
const entitySnakePlural = entitySnake + 's';

// ---------- Field parsing ----------

const FIELD_TYPES = {
  string: { prisma: 'String', zod: 'z.string().min(1)', ts: 'string', input: 'Input' },
  text: { prisma: 'String', zod: 'z.string()', ts: 'string', input: 'TextArea' },
  int: { prisma: 'Int', zod: 'z.coerce.number().int()', ts: 'number', input: 'InputNumber' },
  float: { prisma: 'Float', zod: 'z.coerce.number()', ts: 'number', input: 'InputNumber' },
  boolean: { prisma: 'Boolean', zod: 'z.boolean()', ts: 'boolean', input: 'Switch' },
  date: { prisma: 'DateTime', zod: 'z.coerce.date()', ts: 'string', input: 'DatePicker' },
  datetime: { prisma: 'DateTime', zod: 'z.coerce.date()', ts: 'string', input: 'DatePicker' },
  json: { prisma: 'Json', zod: 'z.unknown()', ts: 'unknown', input: 'TextArea' },
};

function parseField(spec) {
  const m = spec.match(/^(\w+):(\w+)(\??)(!?)$/);
  if (!m) throw new Error(`Invalid field "${spec}" -- expected "name:type[?][!]".`);
  const [, name, type, opt, idx] = m;
  if (!FIELD_TYPES[type]) {
    throw new Error(`Unknown field type "${type}" in "${spec}". Known: ${Object.keys(FIELD_TYPES).join(', ')}.`);
  }
  return { kind: 'scalar', name, type, optional: opt === '?', indexed: idx === '!' };
}

function parseEnum(spec) {
  const m = spec.match(/^([a-z]\w*):([A-Z0-9_|]+)(\??)$/);
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
  const m = spec.match(/^(\w+):([A-Z]\w*)(\??)$/);
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
    ...relations.map((r) => `  ${r.name}Id: z.string().min(1).optional(),`),
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
  const writeWrap = adminWrites ? 'withAdminAuth' : 'withAuth';
  const wrapImports = adminWrites ? 'withAuth, withAdminAuth' : 'withAuth';
  const searchField = fields.find((f) => f.type === 'string' && !f.optional);
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

  const includeClause = relations.length === 0
    ? ''
    : `
      include: {
${relations.map((r) => `        ${r.name}: { select: { id: true, ${r.displayField}: true } },`).join('\n')}
      },`;

  return `import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ${wrapImports} } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { create${Pascal}Schema } from "@/lib/validations/${entityKebab}";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);
${searchClause}
  const [data, total] = await Promise.all([
    prisma.${entityCamel}.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },${includeClause}
    }),
    prisma.${entityCamel}.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
});

export const POST = ${writeWrap}(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = create${Pascal}Schema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const ${entityCamel} = await prisma.${entityCamel}.create({ data: parsed.data });

  return created(${entityCamel});
});
`;
}

function apiItemRouteFile() {
  const writeWrap = adminWrites ? 'withAdminAuth' : 'withAuth';
  const wrapImports = adminWrites ? 'withAuth, withAdminAuth' : 'withAuth';

  const includeClause = relations.length === 0
    ? ''
    : ` include: {
${relations.map((r) => `      ${r.name}: { select: { id: true, ${r.displayField}: true } },`).join('\n')}
    },`;

  return `import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ${wrapImports} } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { update${Pascal}Schema } from "@/lib/validations/${entityKebab}";

export const GET = withAuth(async (_request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const record = await prisma.${entityCamel}.findUnique({ where: { id },${includeClause} });
  if (!record) return notFound("${Pascal}");
  return ok(record);
});

export const PUT = ${writeWrap}(async (request: NextRequest, ctx) => {
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
});

export const DELETE = ${writeWrap}(async (_request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.${entityCamel}.findUnique({ where: { id } });
  if (!existing) return notFound("${Pascal}");
  await prisma.${entityCamel}.delete({ where: { id } });
  return ok({ id });
});
`;
}

function recordTypeFields() {
  return [
    ...fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}${f.optional ? ' | null' : ''}`),
    ...enums.map((e) => `${e.name}${e.optional ? '?' : ''}: ${e.values.map((v) => `"${v}"`).join(' | ')}${e.optional ? ' | null' : ''}`),
    ...relations.flatMap((r) => [
      `${r.name}Id${r.optional ? '?' : ''}: string${r.optional ? ' | null' : ''}`,
      `${r.name}${r.optional ? '?' : ''}: { id: string; ${r.displayField}: string${r.displayField === 'id' ? '' : ' | null'} }${r.optional ? ' | null' : ''}`,
    ]),
  ];
}

function columnsFile() {
  const recordType = `{ id: string; ${recordTypeFields().join('; ')}; createdAt: string; }`;
  const TAG_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'magenta', 'gold'];

  const scalarCols = fields.map((f) => `    {
      title: "${f.name}",
      dataIndex: "${f.name}",
      key: "${f.name}",
      sorter: true,
    },`);

  const enumCols = enums.map((e) => {
    const colorMap = e.values.map((v, i) => `"${v}": "${TAG_COLORS[i % TAG_COLORS.length]}"`).join(', ');
    return `    {
      title: "${e.name}",
      dataIndex: "${e.name}",
      key: "${e.name}",
      render: (val: string | null) => {
        if (!val) return "-";
        const colors: Record<string, string> = { ${colorMap} };
        return <Tag color={colors[val] ?? "default"}>{val}</Tag>;
      },
      filters: [${e.values.map((v) => `{ text: "${v}", value: "${v}" }`).join(', ')}],
    },`;
  });

  const relationCols = relations.map((r) => `    {
      title: "${r.name}",
      key: "${r.name}",
      render: (_: unknown, record: ${Pascal}Record) => record.${r.name}?.${r.displayField} ?? "-",
    },`);

  const usesTag = enums.length > 0;
  const antdImports = ['Button', 'Space'];
  if (usesTag) antdImports.push('Tag');

  return `"use client";

import { ${antdImports.join(', ')} } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { ConfirmAction } from "@/components/shared/ConfirmAction";

export interface ${Pascal}Record ${recordType}

export function get${Pascal}Columns({
  onEdit,
  onDelete,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}): ColumnsType<${Pascal}Record> {
  return [
${[...scalarCols, ...enumCols, ...relationCols].join('\n')}
    {
      title: "Created",
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
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => onEdit(record.id)} />
          <ConfirmAction title="Delete?" onConfirm={() => onDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </ConfirmAction>
        </Space>
      ),
    },
  ];
}
`;
}

function formFile() {
  const scalarItems = fields.map((f) => {
    const widget =
      f.type === 'boolean' ? '<Switch />'
      : f.type === 'int' || f.type === 'float' ? '<InputNumber style={{ width: "100%" }} />'
      : f.type === 'date' || f.type === 'datetime' ? '<DatePicker style={{ width: "100%" }} />'
      : f.type === 'text' || f.type === 'json' ? '<Input.TextArea rows={4} />'
      : '<Input />';
    return `      <Form.Item name="${f.name}" label="${f.name}" rules={[{ required: ${!f.optional} }]}>
        ${widget}
      </Form.Item>`;
  });

  const enumItems = enums.map((e) => `      <Form.Item name="${e.name}" label="${e.name}" rules={[{ required: ${!e.optional} }]}>
        <Select options={[${e.values.map((v) => `{ value: "${v}", label: "${v}" }`).join(', ')}]} />
      </Form.Item>`);

  const relationItems = relations.map((r) => `      <Form.Item name="${r.name}Id" label="${r.name}" rules={[{ required: ${!r.optional} }]}>
        <RelationSelect path="/api/${r.targetKebab}" displayField="${r.displayField}" />
      </Form.Item>`);

  // Form value type aligns with the Record type from columnsFile: optional
  // scalars include `| null` so `<Form initialValues={record}>` accepts the
  // Prisma row shape (where optional fields can be null) directly.
  const valueTypeParts = [
    ...fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}${f.optional ? ' | null' : ''}`),
    ...enums.map((e) => `${e.name}${e.optional ? '?' : ''}: ${e.values.map((v) => `"${v}"`).join(' | ')}${e.optional ? ' | null' : ''}`),
    ...relations.map((r) => `${r.name}Id${r.optional ? '?' : ''}: string${r.optional ? ' | null' : ''}`),
  ];
  const valueType = `{ ${valueTypeParts.join('; ')} }`;

  const antdImports = ['Form', 'Input', 'Button', 'Space'];
  if (fields.some((f) => ['int', 'float'].includes(f.type))) antdImports.push('InputNumber');
  if (fields.some((f) => f.type === 'boolean')) antdImports.push('Switch');
  if (fields.some((f) => ['date', 'datetime'].includes(f.type))) antdImports.push('DatePicker');
  if (enums.length > 0 || relations.length > 0) antdImports.push('Select');

  const relationSelectComponent = relations.length === 0 ? '' : `
function RelationSelect({ path, displayField, value, onChange }: {
  path: string;
  displayField: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(path + "?pageSize=100")
      .then((r) => r.json())
      .then((j) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setOptions((j.data?.data ?? []).map((r: any) => ({
          value: r.id,
          label: r[displayField] ?? r.id,
        })));
      })
      .finally(() => setLoading(false));
  }, [path, displayField]);
  return <Select loading={loading} options={options} value={value} onChange={onChange} showSearch optionFilterProp="label" />;
}
`;

  const reactImports = relations.length === 0 ? '' : 'import { useEffect, useState } from "react";\n';

  return `"use client";

${reactImports}import { ${antdImports.join(', ')} } from "antd";

interface ${Pascal}FormProps {
  initialValues?: Partial<${valueType}>;
  onSubmit: (values: ${valueType}) => void;
  onCancel: () => void;
  loading?: boolean;
}
${relationSelectComponent}
export function ${Pascal}Form({ initialValues, onSubmit, onCancel, loading = false }: ${Pascal}FormProps) {
  return (
    <Form layout="vertical" initialValues={initialValues} onFinish={onSubmit} style={{ maxWidth: 500 }}>
${[...scalarItems, ...enumItems, ...relationItems].join('\n')}
      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>Save</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
`;
}

function listPageFile() {
  return `"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import { get${Pascal}Columns, type ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";

const { Title } = Typography;

export default function ${Pascal}sPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { success, error: showError } = useNotify();
  const { list, remove, loading } = useCrud<${Pascal}Record>({ basePath: "/api/${entityKebab}" });
  const locale = pathname.startsWith("/ar") ? "ar" : "en";

  const [items, setItems] = useState<${Pascal}Record[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const result = await list({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
      });
      setItems(result.data);
      setTotal(result.total);
    } catch {
      showError("Failed to load");
    }
  }, [page, pageSize, search, list, showError]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      success("Deleted");
      fetchItems();
    } catch {
      showError("Failed to delete");
    }
  };

  const columns = get${Pascal}Columns({
    onEdit: (id) => router.push(\`/\${locale}/${entityKebab}/\${id}\`),
    onDelete: handleDelete,
  });

  return (
    <>
      <Space style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>${Pascal}s</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(\`/\${locale}/${entityKebab}/new\`)}>
          New ${Pascal}
        </Button>
      </Space>
      <DataTable<${Pascal}Record>
        columns={columns}
        dataSource={items}
        loading={loading}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        searchable
        onSearch={setSearch}
      />
    </>
  );
}
`;
}

function newPageFile() {
  return `"use client";

import { useRouter, usePathname } from "next/navigation";
import { Typography } from "antd";
import { ${Pascal}Form } from "@/components/${entityKebab}/${Pascal}Form";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";
import type { ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";

const { Title } = Typography;

export default function New${Pascal}Page() {
  const router = useRouter();
  const pathname = usePathname();
  const { success, error: showError } = useNotify();
  const { create, loading } = useCrud<${Pascal}Record>({ basePath: "/api/${entityKebab}" });
  const locale = pathname.startsWith("/ar") ? "ar" : "en";

  const handleSubmit = async (values: Partial<${Pascal}Record>) => {
    try {
      await create(values);
      success("Created");
      router.push(\`/\${locale}/${entityKebab}\`);
    } catch {
      showError("Failed to create");
    }
  };

  return (
    <>
      <Title level={2}>New ${Pascal}</Title>
      <${Pascal}Form
        onSubmit={handleSubmit}
        onCancel={() => router.push(\`/\${locale}/${entityKebab}\`)}
        loading={loading}
      />
    </>
  );
}
`;
}

function editPageFile() {
  return `"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useParams } from "next/navigation";
import { Typography, Spin } from "antd";
import { ${Pascal}Form } from "@/components/${entityKebab}/${Pascal}Form";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";
import type { ${Pascal}Record } from "@/components/${entityKebab}/${Pascal}Columns";

const { Title } = Typography;

export default function Edit${Pascal}Page() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const { success, error: showError } = useNotify();
  const { getById, update, loading } = useCrud<${Pascal}Record>({ basePath: "/api/${entityKebab}" });
  const locale = pathname.startsWith("/ar") ? "ar" : "en";

  const [record, setRecord] = useState<${Pascal}Record | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    getById(params.id).then(setRecord).catch(() => showError("Failed to load"));
  }, [params?.id, getById, showError]);

  const handleSubmit = async (values: Partial<${Pascal}Record>) => {
    if (!params?.id) return;
    try {
      await update(params.id, values);
      success("Saved");
      router.push(\`/\${locale}/${entityKebab}\`);
    } catch {
      showError("Failed to save");
    }
  };

  if (!record) return <Spin />;

  return (
    <>
      <Title level={2}>Edit ${Pascal}</Title>
      <${Pascal}Form
        initialValues={record}
        onSubmit={handleSubmit}
        onCancel={() => router.push(\`/\${locale}/${entityKebab}\`)}
        loading={loading}
      />
    </>
  );
}
`;
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
  const path = join(ROOT, 'app/api/recycling-bin/route.ts');
  const src = await readFile(path, 'utf8');
  if (src.includes(`${Pascal}: { displayField`)) return null;
  const marker = '  // Add more entity types here as you create them:';
  if (!src.includes(marker)) throw new Error('Could not locate ENTITY_TYPES marker.');
  const insertion = `  ${Pascal}: { displayField: "${displayField}" },\n`;
  return { path, content: src.replace(marker, insertion + marker) };
}

async function patchSidebar() {
  const path = join(ROOT, 'components/layout/AppSidebar.tsx');
  const src = await readFile(path, 'utf8');
  if (src.includes(`key: "${entityKebab}"`)) return null;

  // Check whether AppstoreOutlined is already in the @ant-design/icons import
  // block. We have to do this BEFORE inserting the menu entry, because the
  // menu entry contains `<AppstoreOutlined />` and would otherwise pollute a
  // file-wide search for the identifier.
  const importMatch = src.match(/import\s+\{([^}]*)\}\s+from\s+"@ant-design\/icons";/);
  const alreadyImported = importMatch && /\bAppstoreOutlined\b/.test(importMatch[1]);

  const marker = '    {\n      key: "recycling-bin",';
  if (!src.includes(marker)) throw new Error('Could not locate recycling-bin nav entry.');
  const insertion = `    {
      key: "${entityKebab}",
      icon: <AppstoreOutlined />,
      label: "${Pascal}s",
      onClick: () => router.push(\`/\${locale}/${entityKebab}\`),
    },
`;
  let out = src.replace(marker, insertion + marker);

  if (!alreadyImported) {
    out = out.replace(
      /(\}\s*from "@ant-design\/icons";)/,
      '  AppstoreOutlined,\n$1'
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

// Schema patch: enums + model + target back-refs.
const schemaPatched = patchedTargetModels(schemaSrc) + enumBlocks() + schemaModelBlock();
const schemaWrite = { path: join(ROOT, 'prisma/schema.prisma'), content: schemaPatched };

const patches = [
  schemaWrite,
  await patchSoftDeleteRegistry(),
  await patchRecyclingBin(),
  await patchSidebar(),
].filter(Boolean);

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
console.log(`  4. Commit; CI verifies build + lint + typecheck.`);
