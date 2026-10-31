import { notFound } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { grantsOf } from "@/lib/core/permissions";
import { hasGroup, type Grants } from "@/lib/rbac/grants";
import type { NavContext } from "./config";
import { navContextAndActor } from "./server-context";

/**
 * Real HTTP status codes for screens a viewer may not open
 * (docs/blueprints/limits.md slice 3, ADR-101).
 *
 * Most screens are client components that used to fetch, get a 403, and draw
 * "You do not have access" — inside a 200. A crawler, a monitor and a browser's
 * history all saw a page that worked. So each such screen now asks its question
 * on the SERVER, before anything streams, and answers 404 (`notFound()`) when the
 * answer is no — the same "out of scope is not found" rule the API routes keep,
 * so the page cannot be used as an existence oracle either.
 *
 * Two kinds of gate:
 *   - SECTION — may this viewer open the screen at all? The predicate is the
 *     screen's OWN refusal condition (the one its client component tested),
 *     over the same `NavContext` the sidebar uses.
 *   - RECORD — does this record exist for this viewer? Answered by the module's
 *     own loader, the one its read route uses (`./record-gate`).
 *
 * WHERE a gate runs matters: a `notFound()` inside a `loading.tsx` Suspense
 * boundary is sent after the 200 has streamed. Gates therefore run in a page or
 * layout with no loading boundary above it; tests/contracts/page-status.test.ts
 * sweeps every dashboard page for that.
 */

type Gate = (ctx: NavContext, grants: Grants) => boolean;

const orgWide: Gate = (c) => c.pms.orgWide;
const jml =
  (...ps: Parameters<NavContext["jml"]>[0][]): Gate =>
  (c) =>
    ps.some((p) => c.jml(p));
const hiring =
  (p: Parameters<NavContext["hiring"]>[0]): Gate =>
  (c) =>
    c.hiring(p);

/** JML settings screens that need `jml.configure` (each screen's own check). */
const JML_CONFIG_SCREENS = [
  "access-checklist",
  "approval-authority",
  "asset-types",
  "calendar",
  "classifications",
  "contacts",
  "contract-types",
  "documents",
  "email-templates",
  "employee-code",
  "employment-types",
  "import-exits",
  "reason-codes",
  "retention",
  "rules",
  "task-routing",
  "templates",
] as const;

export const SECTION_GATES = {
  // Admin — Performance and platform screens.
  "/admin/access": (c) => c.isAdmin || c.pms.loginsManage,
  "/admin/cycles": (c) => c.pms.hr,
  "/admin/edge-cases": orgWide,
  "/admin/import": (c) => c.pms.previewImport,
  // The imports hub's history route (ADR-096): org-wide jml.configure only.
  "/admin/imports": (c, g) =>
    c.pms.previewImport || hasGroup(g, "jml.configure") || c.hiring("hiring.manage"),
  "/admin/org-setup": (c) => c.pms.orgManage,
  "/admin/settings/ai": hiring("hiring.configure"),
  // ADR-102: both halves are group-wide permissions in their modules.
  "/admin/settings/hr-coverage": (c, g) =>
    hasGroup(g, "tickets.configure") || hasGroup(g, "jml.configure"),
  "/admin/strategy-scores": orgWide,
  "/audit-log": (c) => c.isAdmin,
  // ADR-095 follow-up: every module's email log, metadata only.
  "/admin/email-log": (c) => c.isAdmin,
  "/recycling-bin": (c) => c.isAdmin,
  "/calibration": (c) => c.pms.runCalibration,
  "/executive": orgWide,
  "/reports": orgWide,
  "/three-sixty": orgWide,
  "/goal-setting": (c) => c.pms.lineManager || c.pms.hr,
  // Hiring.
  "/hiring": hiring("hiring.view"),
  "/hiring/insights": hiring("hiring.view"),
  "/hiring/library": hiring("hiring.view"),
  "/hiring/settings": hiring("hiring.manage"),
  // Joiners, movers & leavers.
  "/jml": jml("jml.view"),
  "/jml/cases": jml("jml.view"),
  "/jml/joiners": jml("jml.view"),
  "/jml/joiners/new": jml("jml.manageJoiners"),
  "/jml/joiners/[id]": jml("jml.manageJoiners"),
  "/jml/movers": jml("jml.view"),
  "/jml/movers/new": jml("jml.manageMovers"),
  "/jml/leavers": jml("jml.view"),
  "/jml/leavers/new": jml("jml.manageLeavers"),
  "/jml/leavers/calendar": jml("jml.view"),
  "/jml/calendar": jml("jml.view"),
  "/jml/statutory": jml("jml.view"),
  "/jml/my-tasks": (c) => c.jml("jml.workTasks") || c.jmlTaskWorker,
  "/jml/reports": jml("jml.viewReports"),
  "/jml/settings": jml("jml.configure", "jml.verifyStatutory"),
  "/jml/settings/statutory": jml("jml.configure", "jml.verifyStatutory"),
  ...(Object.fromEntries(
    JML_CONFIG_SCREENS.map((s) => [`/jml/settings/${s}`, jml("jml.configure")]),
  ) as Record<`/jml/settings/${(typeof JML_CONFIG_SCREENS)[number]}`, Gate>),
} satisfies Record<string, Gate>;

export type Section = keyof typeof SECTION_GATES;

/** Pure: may this viewer open the section? (Contract-tested.) */
export function sectionAllowed(section: Section, ctx: NavContext, grants: Grants): boolean {
  return SECTION_GATES[section](ctx, grants);
}

/** The signed-in session; 404 without one (middleware sends the signed-out to login first). */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) notFound();
  return session;
}

/**
 * Server gate for a screen: 404 unless the viewer may open `section`. Call it
 * at the top of a server page or a layout with NO loading boundary above it.
 */
export async function requireSection(section: Section): Promise<Session> {
  const session = await requireSession();
  const { ctx, actor } = await navContextAndActor(session);
  if (!sectionAllowed(section, ctx, grantsOf(actor))) notFound();
  return session;
}
