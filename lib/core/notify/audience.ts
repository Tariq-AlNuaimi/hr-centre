import { loadGrants } from "@/lib/rbac/resolve";
import type { Grants } from "@/lib/rbac/grants";

/**
 * Who may be told about a record: the ONE access check every notice passes
 * before it is written or emailed (docs/blueprints/limits.md slice 2). A notice
 * is about the record its link opens, so the rule is "only people who can open
 * that link" — decided by the SAME loaders the record's read route uses (the
 * requisition / offer / panel loads, the ticket reach, the JML case
 * visibility). A hiring manager scoped to Rihal therefore never hears about a
 * Transformation Pioneers requisition, whatever role or delegation put them on
 * the recipient list.
 *
 * Covered: the module pages of Hiring (`/hiring/...`), HR tickets (`/tickets/...`)
 * and JML (`/jml/...`), plus the two personal inboxes (`/approvals`,
 * `/jml/my-tasks`), which list only the viewer's own items. A link under a
 * covered prefix that no rule knows is REFUSED (fail closed, warned) — a new
 * notice kind must add its rule here. Links outside these prefixes (the
 * Performance ladder, which addresses people by the org tree) pass unchanged.
 *
 * Module code is imported lazily: the module emitters import the core
 * notification writer, so static imports back into them would be a cycle, and
 * a Performance-only caller should not load Hiring.
 */

type Person = { userId: string; grants: Grants };
type Readers = (id: string, people: readonly Person[]) => Promise<Set<string>>;

/** Each person the loader accepts. For per-person loaders (≤ 50 recipients a notice). */
async function each(
  people: readonly Person[],
  opens: (p: Person) => Promise<boolean>,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of people) if (await opens(p).catch(() => false)) out.add(p.userId);
  return out;
}

const hiringActor = (p: Person) => ({ userId: p.userId, name: "", grants: p.grants });

const requisitionReaders: Readers = async (id, people) => {
  const { loadRequisition } = await import("@/lib/hiring/requisitions");
  return each(people, async (p) => (await loadRequisition(hiringActor(p), id)) !== null);
};

const offerReaders: Readers = async (id, people) => {
  const { loadOffer } = await import("@/lib/hiring/offers");
  return each(people, async (p) => (await loadOffer(hiringActor(p), id)) !== null);
};

const panelReaders: Readers = async (id, people) => {
  const { loadMyInterview } = await import("@/lib/hiring/panel");
  // Throws (404) for anyone not on the panel or out of scope.
  return each(people, async (p) => Boolean(await loadMyInterview(hiringActor(p), id)));
};

const ticketReaders: Readers = async (id, people) => {
  const { ticketReaderIds } = await import("@/lib/hive/services/permissions");
  return ticketReaderIds(
    id,
    people.map((p) => p.userId),
  );
};

const caseReaders: Readers = async (id, people) => {
  const { caseViewerIds } = await import("@/lib/jml/access");
  return caseViewerIds(id, people);
};

const everyone: Readers = async (_id, people) => new Set(people.map((p) => p.userId));

/** Link → whose eyes it may reach. First match wins; the id is capture group 1. */
const RULES: ReadonlyArray<[RegExp, Readers]> = [
  [/^\/hiring\/requisitions\/([^/?#]+)(?:[/?#]|$)/, requisitionReaders],
  [/^\/hiring\/offers\/([^/?#]+)(?:[/?#]|$)/, offerReaders],
  [/^\/hiring\/panel\/([^/?#]+)\/score(?:[/?#]|$)/, panelReaders],
  [/^\/tickets\/([^/?#]+)(?:[/?#]|$)/, ticketReaders],
  [/^\/jml\/cases\/([^/?#]+)(?:[/?#]|$)/, caseReaders],
  // Personal inboxes: the page lists only the viewer's own items.
  [/^\/approvals()(?:[?#]|$)/, everyone],
  [/^\/jml\/my-tasks()(?:[?#]|$)/, everyone],
];

/** Prefixes whose links MUST match a rule (fail closed when none does). */
const GATED = /^\/(?:hiring|tickets|jml|approvals)(?:[/?#]|$)/;

/** Is this link one the gate decides (rather than passes through)? */
export function isGatedHref(href: string | null): boolean {
  return href !== null && GATED.test(href);
}

/** Does a gated link have a rule? (Contract test: every emitter's link must.) */
export function hasAccessRule(href: string): boolean {
  return RULES.some(([re]) => re.test(href));
}

/**
 * The subset of `userIds` who can open `href`. Ungated links (null, or outside
 * the covered modules) return everyone. Never throws: a check that fails
 * refuses that link's recipients (fail closed) and warns without detail.
 */
export async function whoCanOpen(
  href: string | null,
  userIds: Iterable<string>,
  grantsFor: (userId: string) => Promise<Grants> = loadGrants,
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!isGatedHref(href)) return new Set(ids);
  const rule = RULES.find(([re]) => re.test(href!));
  if (!rule) {
    console.warn("[notify] a notice link has no access rule; recipients refused");
    return new Set();
  }
  try {
    const id = decodeURIComponent(rule[0].exec(href!)![1]);
    const people = await Promise.all(
      ids.map(async (userId) => ({ userId, grants: await grantsFor(userId) })),
    );
    return await rule[1](id, people);
  } catch {
    console.warn("[notify] a notice access check failed; recipients refused");
    return new Set();
  }
}

/** Memoised grants for one batch: each recipient's assignments are read once. */
export function grantsMemo(): (userId: string) => Promise<Grants> {
  const cache = new Map<string, Promise<Grants>>();
  return (userId) => {
    let g = cache.get(userId);
    if (!g) {
      g = loadGrants(userId);
      cache.set(userId, g);
    }
    return g;
  };
}
