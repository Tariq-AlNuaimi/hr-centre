"use client";

// Living style guide — the design system on one screen. Doubles as a
// /design-qa target (every shared pattern + control state in light/dark/RTL)
// and as handoff documentation for the IT team. NOT in the sidebar nav: it's a
// reference, reachable at /<locale>/style-guide, not a stakeholder-facing
// feature. Labels here are intentionally hardcoded (a dev/design reference is
// exempt from the next-intl convention) — everything it *demonstrates* still
// flows through tokens + the shared components. (ADR-029 C3: fully migrated off
// AntD onto the shadcn/Tailwind primitive layer.)

import { useState } from "react";
import type { ColumnsType } from "@/components/shared/table-types";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatCard } from "@/components/shared/StatCard";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { DataView } from "@/components/shared/DataView";
import { DataTable } from "@/components/shared/DataTable";
import { Toolbar } from "@/components/shared/Toolbar";
import { BrandedStatus } from "@/components/shared/BrandedStatus";
import {
  PageSkeleton,
  TableSkeleton,
  FormSkeleton,
} from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { brand } from "@/brand.config";
import { OPEN_COMMAND_PALETTE } from "@/components/layout/CommandPalette";

/* --- Inline icons (Preflight-off SVGs; replaces @ant-design/icons) --------- */
type IconProps = { className?: string };
function Icon({ path, className }: { path: string } & IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn("h-4 w-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
const PlusIcon = (p: IconProps) => <Icon path="M12 5v14M5 12h14" {...p} />;
const DownloadIcon = (p: IconProps) => (
  <Icon path="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" {...p} />
);
const UserIcon = (p: IconProps) => (
  <Icon
    path="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
    {...p}
  />
);
const TrashIcon = (p: IconProps) => (
  <Icon
    path="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
    {...p}
  />
);
const ShieldIcon = (p: IconProps) => (
  <Icon path="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4" {...p} />
);
const LockIcon = (p: IconProps) => (
  <Icon
    path="M5 11h14v10H5V11Zm2 0V7a5 5 0 0 1 10 0v4"
    {...p}
  />
);
const ToolIcon = (p: IconProps) => (
  <Icon
    path="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.7-.7-.7-2.7 2.4-2.2Z"
    {...p}
  />
);

/* --- Inline alert (token-tinted; replaces AntD Alert) ---------------------- */
function InlineAlert({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const success = tone === "success";
  return (
    <div
      role={success ? "status" : "alert"}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4 flex-none"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {success ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        )}
      </svg>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="m-0 text-h4 font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
      <hr className="my-6 border-0 border-t border-border" />
    </section>
  );
}

type GalleryRow = { id: string; name: string; role: string; status: string };

export default function StyleGuidePage() {
  const [showSkeletons, setShowSkeletons] = useState(false);

  const sampleColumns: ColumnsType<GalleryRow> = [
    { title: "Name", dataIndex: "name", key: "name" },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      render: (r: string) => <Badge>{r}</Badge>,
    },
    { title: "Status", dataIndex: "status", key: "status" },
  ];
  const sampleData: GalleryRow[] = [
    { id: "1", name: "Sara Al-Hinai", role: "ADMIN", status: "Active" },
    { id: "2", name: "Yousef Said", role: "EDITOR", status: "Active" },
    { id: "3", name: "Layla Nasser", role: "VIEWER", status: "Invited" },
  ];

  // Brand color swatches ride the token utilities (no raw hex in a component).
  const swatches: { name: string; className: string }[] = [
    { name: "primary", className: "bg-primary" },
    { name: "success", className: "bg-emerald-500" },
    { name: "warning", className: "bg-amber-500" },
    { name: "error", className: "bg-destructive" },
  ];

  return (
    <>
      <PageHeader
        title="Style guide"
        subtitle="The design system in one place — tokens, typography, controls, and the shared patterns. Use it as the fidelity reference and the /design-qa target."
        actions={
          <Button variant="outline">
            <DownloadIcon />
            Export tokens
          </Button>
        }
      />

      <Section title="Typography">
        <h1 className="m-0 text-h1 font-bold text-foreground">Heading 1</h1>
        <h2 className="m-0 text-h2 font-bold text-foreground">Heading 2</h2>
        <h3 className="m-0 text-h3 font-semibold text-foreground">Heading 3</h3>
        <h4 className="m-0 text-h4 font-semibold text-foreground">Heading 4</h4>
        <p className="mt-3 max-w-[65ch] text-sm text-foreground">
          Body text sits on the type scale in <code>app/tokens.css</code>.{" "}
          <span className="text-muted-foreground">Secondary</span>,{" "}
          <span className="text-emerald-700 dark:text-emerald-400">success</span>,{" "}
          <span className="text-amber-700 dark:text-amber-400">warning</span>,{" "}
          <span className="text-red-700 dark:text-red-400">danger</span>, and{" "}
          <span className="font-semibold">strong</span> variants.
        </p>
      </Section>

      <Section title="Buttons — one primary action per screen">
        <div className="flex flex-wrap items-center gap-2">
          <Button>
            <PlusIcon />
            Primary
          </Button>
          <Button variant="outline">Default</Button>
          <Button variant="outline" className="border-dashed">
            Dashed
          </Button>
          <Button variant="ghost">Text</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Danger</Button>
          <Button disabled>
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground"
            />
            Loading
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="flex w-full max-w-90 flex-col gap-4">
          <Input placeholder="Text input" />
          <Select>
            <SelectTrigger aria-label="Role">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Switch defaultChecked aria-label="Toggle" /> Toggle
          </span>
        </div>
      </Section>

      <Section title="Status & feedback">
        <div className="flex w-full flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="brand">Default</Badge>
            <Badge variant="success">Active</Badge>
            <Badge variant="warning">Pending</Badge>
            <Badge variant="danger">Blocked</Badge>
          </div>
          <InlineAlert tone="success">Saved successfully.</InlineAlert>
          <InlineAlert tone="error">
            Something went wrong. Try again.
          </InlineAlert>
        </div>
      </Section>

      <Section title="Table">
        <DataTable<GalleryRow>
          columns={sampleColumns}
          dataSource={sampleData}
          rowKey="id"
        />
      </Section>

      <Section title="Empty state">
        <EmptyState
          description="No records yet"
          actionLabel="Create one"
          onAction={() => {}}
        />
      </Section>

      <Section title="Brand identity (brand.config.ts)">
        <div className="flex flex-wrap items-center gap-6">
          <span
            aria-hidden
            className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground"
          >
            {brand.monogram}
          </span>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {brand.appName}
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              Font: {brand.font.family} · density: {brand.density}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          {swatches.map((s) => (
            <div key={s.name} className="text-center">
              <div
                className={cn(
                  "h-14 w-14 rounded-md border border-border",
                  s.className,
                )}
              />
              <span className="text-xs text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="KPI cards (StatCard)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total users"
            value="1,284"
            icon={<UserIcon className="h-5 w-5" />}
            trend={{ value: 12, direction: "up" }}
          />
          <StatCard
            title="Deleted records"
            value="37"
            icon={<TrashIcon className="h-5 w-5" />}
            trend={{ value: 4, direction: "down", positiveIsGood: false }}
          />
          <StatCard
            title="Roles in use"
            value="3"
            icon={<ShieldIcon className="h-5 w-5" />}
            hint="Admin · Editor · Viewer"
          />
        </div>
      </Section>

      <Section title="Section card">
        <SectionCard
          title="Team members"
          subtitle="People with access to this workspace"
          actions={
            <Button>
              <PlusIcon />
              Invite
            </Button>
          }
        >
          <DataTable<GalleryRow>
            columns={sampleColumns}
            dataSource={sampleData}
            rowKey="id"
          />
        </SectionCard>
      </Section>

      <Section title="Description list (detail view)">
        <DescriptionList
          items={[
            { key: "name", label: "Name", value: "Sara Al-Hinai" },
            { key: "role", label: "Role", value: <Badge variant="brand">ADMIN</Badge> },
            { key: "email", label: "Email", value: "sara@example.com" },
            { key: "status", label: "Status", value: <Badge variant="success">Active</Badge> },
          ]}
        />
      </Section>

      <Section title="Data view — toolbar + bulk actions + column controls">
        <DataView<GalleryRow>
          dataSource={sampleData}
          columns={[
            { title: "Name", dataIndex: "name", key: "name" },
            {
              title: "Role",
              dataIndex: "role",
              key: "role",
              render: (r: string) => <Badge>{r}</Badge>,
            },
            { title: "Status", dataIndex: "status", key: "status" },
          ]}
          searchable
          toolbarActions={
            <Button>
              <PlusIcon />
              New
            </Button>
          }
          bulkActions={({ selectedRowKeys, clear }) => (
            <Button variant="destructive" onClick={clear}>
              <TrashIcon />
              Delete {selectedRowKeys.length}
            </Button>
          )}
        />
      </Section>

      <Section title="Toolbar">
        <Toolbar
          start={
            <div className="relative max-w-56">
              <UserIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Filter…" className="ps-9" />
            </div>
          }
          end={
            <Button>
              <PlusIcon />
              Create
            </Button>
          }
        />
      </Section>

      <Section title="Status pages (BrandedStatus)">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { code: "404", title: "Page not found", icon: undefined },
            { code: "403", title: "Access denied", icon: <LockIcon /> },
            {
              code: undefined,
              title: "We'll be right back",
              icon: <ToolIcon />,
            },
          ].map((s, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-border"
            >
              <BrandedStatus
                minHeight={220}
                code={s.code}
                icon={s.icon}
                title={s.title}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Command palette & chrome">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))
            }
          >
            Open command palette (⌘K)
          </Button>
          <span className="text-sm text-muted-foreground">
            Notifications bell + workspace switcher live in the app header.
          </span>
        </div>
      </Section>

      <Section title="Loading skeletons (layout-matched)">
        <div className="flex w-full flex-col gap-6">
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={showSkeletons}
              onCheckedChange={setShowSkeletons}
              aria-label="Toggle skeletons"
            />
            Toggle skeletons
          </span>
          {showSkeletons ? (
            <div className="flex w-full flex-col gap-6">
              <PageSkeleton rows={3} withAction />
              <TableSkeleton rows={4} />
              <FormSkeleton fields={3} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              Flip the switch to preview the loading silhouettes.
            </span>
          )}
        </div>
      </Section>

      <Section title="Tailwind foundation (ADR-029 C1)">
        {/* Smoke surface for the Tailwind v4 layer: every swatch below is
            styled ONLY with utilities riding the same tokens.css/@theme ruler
            AntD uses — brand color, 4px spacing, radius, elevation, and the
            data-theme–driven dark: variant. C2 rebuilds components/shared/*
            on this layer. */}
        <div className="flex flex-wrap items-center gap-density-control-gap font-sans">
          <span className="rounded-md bg-primary px-4 py-2 text-base text-white shadow-sm">
            bg-primary
          </span>
          <span className="rounded-lg border border-solid border-accent px-4 py-2 text-base text-accent">
            border-accent
          </span>
          <span className="rounded-sm bg-slate-100 px-4 py-2 text-xs shadow-md dark:bg-slate-800 dark:text-slate-100">
            dark: follows data-theme
          </span>
          <span className="p-density-card text-h5 shadow-lg rounded-lg">
            density + type scale
          </span>
        </div>
      </Section>
    </>
  );
}
