import type { ReactNode } from "react";

/**
 * The employee record's header (UX review R10): initials, name, "job title ·
 * department · company", status and reporting line, with the record's single
 * Edit control and Actions menu on the right. Server-renderable.
 */
export function RecordHeader({
  name,
  meta,
  status,
  manager,
  reportsToLabel,
  actions,
}: {
  name: string;
  /** Job title, department, company — blanks are skipped. */
  meta: Array<string | null | undefined>;
  status: ReactNode;
  manager: ReactNode | null;
  reportsToLabel: string;
  actions: ReactNode;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const line = meta.filter((m): m is string => Boolean(m)).join(" · ");
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-base font-semibold text-nav-active-foreground"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-h3 font-semibold text-foreground">{name}</h2>
          {line ? <p className="mt-1 text-sm text-muted-foreground">{line}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {status}
            {manager ? (
              <span>
                {reportsToLabel} {manager}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
