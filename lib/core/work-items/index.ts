import type { Session } from "next-auth";

/**
 * "My work" — one list of what is waiting on the signed-in person, across
 * modules (docs/blueprints/ux-p0.md, US-1). A READ MODEL, not a table: each
 * module registers a provider that reads its own tables with its own
 * permission rules, and this fans in. Nothing is copied, so nothing drifts.
 *
 * Contract every provider keeps:
 *   - permission-checked with the module's own rules (out of scope = absent);
 *   - bounded: it returns at most PROVIDER_LIMIT items, plus its true total;
 *   - English-free: it returns a message KIND and params; the UI translates.
 * A provider that throws is reported in `failed` — never silently dropped, so
 * Home can say "couldn't load Hiring" instead of claiming nothing is waiting.
 */

export type WorkModule = "performance" | "jml" | "hiring" | "tickets";

export type WorkItem = {
  /** Stable React key, unique across modules. */
  key: string;
  module: WorkModule;
  /** Message key under `work.kind` — the UI's sentence for this item. */
  kind: string;
  params: Record<string, string | number>;
  /** When it is due (ISO), or null when the work has no deadline. */
  dueAt: string | null;
  /** Locale-less path to act on it. */
  href: string;
};

export type ProviderResult = { items: WorkItem[]; total: number };

export type WorkProvider = {
  module: WorkModule;
  collect: (session: Session, now: Date) => Promise<ProviderResult>;
};

export const PROVIDER_LIMIT = 20;

export type WorkList = {
  items: WorkItem[];
  /** Per module: how many there are in all (items may be capped). */
  totals: Partial<Record<WorkModule, number>>;
  failed: WorkModule[];
};

export async function collectWorkItems(
  session: Session,
  providers: readonly WorkProvider[],
  now: Date = new Date(),
): Promise<WorkList> {
  const settled = await Promise.allSettled(providers.map((p) => p.collect(session, now)));
  const items: WorkItem[] = [];
  const totals: WorkList["totals"] = {};
  const failed: WorkModule[] = [];
  settled.forEach((r, i) => {
    const mod = providers[i].module;
    if (r.status === "rejected") {
      failed.push(mod);
      // Not detailed: a provider's error can carry names or ticket text.
      console.warn(`[work-items] the ${mod} provider failed`);
      return;
    }
    items.push(...r.value.items.slice(0, PROVIDER_LIMIT));
    totals[mod] = (totals[mod] ?? 0) + r.value.total;
  });
  items.sort(byDue);
  return { items, totals, failed };
}

/** Earliest due first; work with no deadline after everything that has one. */
export function byDue(a: Pick<WorkItem, "dueAt">, b: Pick<WorkItem, "dueAt">): number {
  if (a.dueAt === b.dueAt) return 0;
  if (a.dueAt === null) return 1;
  if (b.dueAt === null) return -1;
  return a.dueAt < b.dueAt ? -1 : 1;
}

export type DueGroup = "overdue" | "thisWeek" | "later";

const DAY_MS = 86_400_000;

/** Overdue (past due), this week (due within 7 days) or later (incl. no deadline). */
export function dueGroup(dueAt: string | null, nowMs: number): DueGroup {
  if (dueAt === null) return "later";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "later";
  if (due < nowMs) return "overdue";
  return due - nowMs <= 7 * DAY_MS ? "thisWeek" : "later";
}
