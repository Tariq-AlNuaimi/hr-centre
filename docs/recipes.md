# Code recipes — copy-paste reference

Moved out of CLAUDE.md (token thrift, ADR-019): load this file only when actually
sending email, exporting Excel, or building a kanban/chart screen.

## Sending email
```ts
import { sendEmail } from "@/lib/email";
const result = await sendEmail({
  to: user.email,
  subject: "Your password reset link",
  text: `Open ${url} to reset. Expires in 1 hour.`,
  html: `<p>Open <a href="${url}">this link</a> to reset. Expires in 1 hour.</p>`,
});
if (!result.sent) { /* SMTP_HOST unset; decide per call site whether fatal */ }
```

## Exporting to Excel
```ts
import { toExcel, excelDownloadHeaders } from "@/lib/export";
import { withAuth } from "@/lib/api-helpers";

export const GET = withAuth(async () => {
  const rows = await prisma.project.findMany({
    include: { owner: { select: { name: true } } },
  });
  const xlsx = await toExcel(rows, [
    { header: "Name", key: "name" },
    { header: "Owner", key: "owner", format: (v) => (v as { name: string } | null)?.name ?? "-" },
    { header: "Created", key: "createdAt", format: (v) => new Date(v as string).toISOString().slice(0, 10) },
  ], { sheetName: "Projects", title: "Project export" });
  return new Response(new Uint8Array(xlsx), {
    headers: excelDownloadHeaders(`projects-${Date.now()}.xlsx`),
  });
});
```
Remember: Excel exports must not include Restricted columns — `SCRUB_FIELDS` does
NOT protect export output. Audit the column list per route.

## Kanban board
```tsx
import { KanbanBoard } from "@/components/shared/KanbanBoard";
import { chartPalette } from "@/components/layout/antd-theme";

// Column accents come off the shared palette in antd-theme.ts — never raw hex
// (the `rihal-template/no-raw-hex-color` rule; tokens are the single source).
const columns = [
  { id: "TODO", title: "To do" },
  { id: "IN_PROGRESS", title: "In progress", color: chartPalette[0] }, // brand/primary
  { id: "DONE", title: "Done", color: chartPalette[1] }, // success green
];

<KanbanBoard
  columns={columns}
  items={tasks.map((t) => ({ ...t, columnId: t.status }))}
  renderCard={(t) => <><b>{t.title}</b><div>{t.assignee?.name}</div></>}
  onMove={async (task, _from, to) => {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    refetch();
  }}
/>
```

## Charts
```tsx
import { Chart } from "@/components/shared/Chart";

const data = [
  { month: "Jan", revenue: 4200 },
  { month: "Feb", revenue: 5100 },
  { month: "Mar", revenue: 4800 },
];
<Chart type="line" data={data} xKey="month" yKey="revenue" height={280} />
<Chart type="bar"  data={data} xKey="month" yKey="revenue" />
<Chart type="pie"  data={[{ name: "TODO", value: 12 }, { name: "DONE", value: 30 }]} nameKey="name" valueKey="value" />
```
