#!/usr/bin/env node
// scripts/scaffold-entity.mjs
//
// Codegen for a new CRUD entity. Mirrors the User reference implementation
// across nine new files and patches three existing ones:
//
//   New files:
//     prisma/schema.prisma                                  (appended)
//     lib/validations/<kebab>.ts
//     app/api/<kebab>/route.ts                              (GET list + POST)
//     app/api/<kebab>/[id]/route.ts                         (GET / PUT / DELETE)
//     components/<kebab>/<Pascal>Columns.tsx
//     components/<kebab>/<Pascal>Form.tsx
//     app/[locale]/(dashboard)/<kebab>/page.tsx             (list)
//     app/[locale]/(dashboard)/<kebab>/new/page.tsx         (create)
//     app/[locale]/(dashboard)/<kebab>/[id]/page.tsx        (edit)
//
//   Patches:
//     lib/prisma/soft-delete-extension.ts   (add to SOFT_DELETE_MODELS)
//     app/api/recycling-bin/route.ts        (add to ENTITY_TYPES)
//     components/layout/AppSidebar.tsx      (add nav item)
//
// Stops before running the Prisma migration -- the operator reviews the
// schema diff first, then runs:
//   npm run prisma:migrate -- --name add_<snake>
//
// Usage:
//   npm run scaffold -- --name Project --fields "name:string,description:string?,status:string!"
//
// See .claude/skills/scaffold-entity/SKILL.md for the full recipe.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = process.cwd();

// ---------- CLI ----------

const { values } = parseArgs({
  options: {
    name: { type: 'string', short: 'n' },
    fields: { type: 'string', short: 'f' },
    'soft-delete': { type: 'string', default: 'true' },
    'admin-writes': { type: 'string', default: 'false' },
    'admin-nav': { type: 'string', default: 'false' },
    'display-field': { type: 'string', default: 'name' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.name) {
  console.error('ERROR: missing --name <PascalCase>');
  console.error('Usage: npm run scaffold -- --name Project --fields "name:string,description:string?,status:string!"');
  process.exit(1);
}

const Entity = values.name;
if (!/^[A-Z][A-Za-z0-9]*$/.test(Entity)) {
  console.error(`ERROR: invalid name "${Entity}" -- must be PascalCase (e.g. Project, TimeEntry).`);
  process.exit(1);
}

const softDelete = values['soft-delete'] !== 'false';
const adminWrites = values['admin-writes'] === 'true';
const adminNav = values['admin-nav'] === 'true';
const displayField = values['display-field'];
const dryRun = values['dry-run'];

// ---------- Name helpers ----------

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
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
  return { name, type, optional: opt === '?', indexed: idx === '!' };
}

const fields = (values.fields ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseField);
if (fields.length === 0) {
  console.error('ERROR: at least one field is required via --fields.');
  process.exit(1);
}

// ---------- Idempotency check ----------

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const guardPaths = [
  `app/api/${entityKebab}/route.ts`,
  `lib/validations/${entityKebab}.ts`,
  `components/${entityKebab}`,
];
for (const p of guardPaths) {
  if (await exists(join(ROOT, p))) {
    console.error(`ERROR: ${p} already exists. Refusing to overwrite.`);
    console.error('If you intend to regenerate, delete the existing files first.');
    process.exit(1);
  }
}

// ---------- Template builders ----------

function schemaModelBlock() {
  const lines = [
    '',
    `model ${Pascal} {`,
    '  id        String   @id @default(cuid())',
  ];
  for (const f of fields) {
    const type = FIELD_TYPES[f.type].prisma + (f.optional ? '?' : '');
    const annotations = [];
    if (f.indexed && !f.optional) annotations.push('@@index');
    lines.push(`  ${f.name.padEnd(9)} ${type}`);
  }
  lines.push('  createdAt DateTime @default(now())');
  lines.push('  updatedAt DateTime @updatedAt');
  if (softDelete) {
    lines.push('  deletedAt DateTime?');
    lines.push('  deletedBy String?');
  }
  // Indexes for fields marked with !
  for (const f of fields.filter((x) => x.indexed)) {
    lines.push(`  @@index([${f.name}])`);
  }
  lines.push(`  @@map("${entitySnakePlural}")`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function validationFile() {
  const createFields = fields.map((f) => {
    let z = FIELD_TYPES[f.type].zod;
    if (f.type === 'string') z += '.max(255)';
    if (f.optional) z += '.optional()';
    return `  ${f.name}: ${z},`;
  }).join('\n');

  const updateFields = fields.map((f) => {
    let z = FIELD_TYPES[f.type].zod;
    if (f.type === 'string') z += '.max(255)';
    z += '.optional()';
    return `  ${f.name}: ${z},`;
  }).join('\n');

  return `import { z } from "zod";

export const create${Pascal}Schema = z.object({
${createFields}
});

export const update${Pascal}Schema = z.object({
${updateFields}
});

export type Create${Pascal}Input = z.infer<typeof create${Pascal}Schema>;
export type Update${Pascal}Input = z.infer<typeof update${Pascal}Schema>;
`;
}

function apiListRouteFile() {
  const writeWrap = adminWrites ? 'withAdminAuth' : 'withAuth';
  const wrapImports = adminWrites
    ? 'withAuth, withAdminAuth'
    : 'withAuth';
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
      orderBy: { createdAt: "desc" },
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

  return `import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ${wrapImports} } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { update${Pascal}Schema } from "@/lib/validations/${entityKebab}";

export const GET = withAuth(async (_request: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const record = await prisma.${entityCamel}.findUnique({ where: { id } });
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
  // Soft-delete if registered in SOFT_DELETE_MODELS, else hard delete.
  await prisma.${entityCamel}.delete({ where: { id } });
  return ok({ id });
});
`;
}

function columnsFile() {
  const recordType = `{ id: string; ${fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}${f.optional ? ' | null' : ''}`).join('; ')}; createdAt: string; }`;

  const fieldColumns = fields.map((f) => `    {
      title: "${f.name}",
      dataIndex: "${f.name}",
      key: "${f.name}",
      sorter: true,
    },`).join('\n');

  return `"use client";

import { Button, Space } from "antd";
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
${fieldColumns}
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
  const formItems = fields.map((f) => {
    const widget =
      f.type === 'boolean' ? '<Switch />'
      : f.type === 'int' || f.type === 'float' ? '<InputNumber style={{ width: "100%" }} />'
      : f.type === 'date' || f.type === 'datetime' ? '<DatePicker style={{ width: "100%" }} />'
      : f.type === 'text' || f.type === 'json' ? '<Input.TextArea rows={4} />'
      : '<Input />';
    return `      <Form.Item name="${f.name}" label="${f.name}" rules={[{ required: ${!f.optional} }]}>
        ${widget}
      </Form.Item>`;
  }).join('\n');

  const valueType = `{ ${fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${FIELD_TYPES[f.type].ts}`).join('; ')} }`;
  const hasNumber = fields.some((f) => ['int', 'float'].includes(f.type));
  const hasSwitch = fields.some((f) => f.type === 'boolean');
  const hasDate = fields.some((f) => ['date', 'datetime'].includes(f.type));
  const imports = ['Form', 'Input', 'Button', 'Space'];
  if (hasNumber) imports.push('InputNumber');
  if (hasSwitch) imports.push('Switch');
  if (hasDate) imports.push('DatePicker');

  return `"use client";

import { ${imports.join(', ')} } from "antd";

interface ${Pascal}FormProps {
  initialValues?: Partial<${valueType}>;
  onSubmit: (values: ${valueType}) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ${Pascal}Form({ initialValues, onSubmit, onCancel, loading = false }: ${Pascal}FormProps) {
  return (
    <Form layout="vertical" initialValues={initialValues} onFinish={onSubmit} style={{ maxWidth: 500 }}>
${formItems}
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

// ---------- Patch functions ----------

async function patchSoftDeleteRegistry() {
  if (!softDelete) return null;
  const path = join(ROOT, 'lib/prisma/soft-delete-extension.ts');
  const src = await readFile(path, 'utf8');
  const re = /const SOFT_DELETE_MODELS = new Set\(\[([^\]]*)\]\);/;
  const m = src.match(re);
  if (!m) throw new Error('Could not locate SOFT_DELETE_MODELS in soft-delete-extension.ts');
  const existing = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (existing.includes(`"${Pascal}"`)) return null; // already registered
  const updated = [...existing, `"${Pascal}"`].join(', ');
  const out = src.replace(re, `const SOFT_DELETE_MODELS = new Set([${updated}]);`);
  return { path, content: out };
}

async function patchRecyclingBin() {
  if (!softDelete) return null;
  const path = join(ROOT, 'app/api/recycling-bin/route.ts');
  const src = await readFile(path, 'utf8');
  if (src.includes(`${Pascal}: { displayField`)) return null;
  // Insert before the "// Add more entity types here" marker.
  const marker = '  // Add more entity types here as you create them:';
  if (!src.includes(marker)) throw new Error('Could not locate ENTITY_TYPES marker in recycling-bin/route.ts');
  const insertion = `  ${Pascal}: { displayField: "${displayField}" },\n`;
  const out = src.replace(marker, insertion + marker);
  return { path, content: out };
}

async function patchSidebar() {
  const path = join(ROOT, 'components/layout/AppSidebar.tsx');
  const src = await readFile(path, 'utf8');
  if (src.includes(`key: "${entityKebab}"`)) return null;
  // Insert above the "recycling-bin" entry.
  const marker = '    {\n      key: "recycling-bin",';
  if (!src.includes(marker)) throw new Error('Could not locate "recycling-bin" nav entry in AppSidebar.tsx');
  const insertion = `    {
      key: "${entityKebab}",
      icon: <AppstoreOutlined />,
      label: "${Pascal}s",
      onClick: () => router.push(\`/\${locale}/${entityKebab}\`),
    },
`;
  // Inject inside admin block if --admin-nav, else outside.
  // For simplicity we always inject above recycling-bin (visible to all signed-in users).
  // Admin-only nav is documented as a manual edit in SKILL.md.
  let out = src.replace(marker, insertion + marker);
  // Ensure AppstoreOutlined is imported.
  if (!/AppstoreOutlined/.test(out)) {
    out = out.replace(
      /from "@ant-design\/icons";/,
      ', AppstoreOutlined } from "@ant-design/icons";'
    ).replace(
      /\{\s*([^}]*?)\s*, AppstoreOutlined \}/,
      '{ $1, AppstoreOutlined }'
    );
    // Fallback if the regex above didn't match because of the icons block being multiline.
    if (!/AppstoreOutlined/.test(out)) {
      out = out.replace(
        /from "@ant-design\/icons";/,
        'AppstoreOutlined,\n} from "@ant-design/icons";'
      );
    }
  }
  return { path, content: out };
}

async function appendSchema() {
  const path = join(ROOT, 'prisma/schema.prisma');
  const src = await readFile(path, 'utf8');
  if (new RegExp(`^model ${Pascal}\\b`, 'm').test(src)) {
    throw new Error(`model ${Pascal} already exists in prisma/schema.prisma`);
  }
  return { path, content: src + schemaModelBlock() };
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

const patches = [
  await appendSchema(),
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
console.log(`  1. Review prisma/schema.prisma (new model block at the end).`);
console.log(`  2. Run: npm run prisma:migrate -- --name add_${entitySnake}`);
console.log(`  3. Run: npm run prisma:generate`);
console.log(`  4. Commit the result; CI will verify build + lint + typecheck.`);
