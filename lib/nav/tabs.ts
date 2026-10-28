import type { Permission } from "@/lib/rbac/catalogue";
import type { NavContext, NavLink } from "./config";

/**
 * Gates and the larger module tab sets for `lib/nav/config.ts` (split out to
 * keep each file small). Gates are affordances — routes re-check on the server.
 */

export type Gate = (ctx: NavContext) => boolean;

export const always: Gate = () => true;
export const hr: Gate = (c) => c.pms.hr;
export const teamLead: Gate = (c) => [c.pms.lineManager, c.pms.hr].some(Boolean);
const orgWide: Gate = (c) => c.pms.orgWide;
export const admin: Gate = (c) => c.isAdmin;
const jml =
  (p: Permission): Gate =>
  (c) =>
    c.jml(p);
export const hiring =
  (p: Permission): Gate =>
  (c) =>
    c.hiring(p);
/** Who may own a requisition: hiring managers, and the HR people who run hiring. */
export const ownsRequisitions: Gate = (c) =>
  [c.hiring("hiring.hiringManager"), c.hiring("hiring.manage")].some(Boolean);
/** Tabs-only entries are shown when any tab is (see `resolve.ts`). */
export const byTabs: Gate = () => true;

/** Joiners & leavers (was 11 sidebar rows). Reports → Insights, Settings → Admin › Settings. */
export const JML_TABS: readonly NavLink[] = [
  { key: "jml-home", label: "jmlOverview", href: "/jml", show: jml("jml.view") },
  {
    key: "jml-my-tasks",
    label: "jmlMyTasks",
    href: "/jml/my-tasks",
    show: (c) => [c.jml("jml.workTasks"), c.jmlTaskWorker].some(Boolean),
  },
  { key: "jml-cases", label: "jmlCases", href: "/jml/cases", show: jml("jml.view") },
  {
    key: "jml-joiners",
    label: "jmlJoiners",
    href: "/jml/joiners",
    show: jml("jml.manageJoiners"),
  },
  { key: "jml-movers", label: "jmlMovers", href: "/jml/movers", show: jml("jml.manageMovers") },
  {
    key: "jml-leavers",
    label: "jmlLeavers",
    href: "/jml/leavers",
    show: jml("jml.manageLeavers"),
  },
  { key: "jml-calendar", label: "jmlCalendar", href: "/jml/calendar", show: jml("jml.view") },
  {
    key: "jml-statutory",
    label: "jmlStatutory",
    href: "/jml/statutory",
    show: jml("jml.view"),
  },
];

/** Hiring (was 13 sidebar rows). My panel → Me, Insights → Insights, Settings → Admin › Settings. */
export const HIRING_TABS: readonly NavLink[] = [
  { key: "hiring-home", label: "hiringOverview", href: "/hiring", show: hiring("hiring.view") },
  {
    key: "hiring-requisitions",
    label: "hiringRequisitions",
    href: "/hiring/requisitions",
    show: hiring("hiring.view"),
    match: ["/hiring/planning"],
  },
  {
    key: "hiring-candidates",
    label: "hiringCandidates",
    href: "/hiring/candidates",
    show: hiring("hiring.manage"),
    match: ["/hiring/import"],
  },
  {
    key: "hiring-pipeline",
    label: "hiringPipeline",
    href: "/hiring/pipeline",
    show: hiring("hiring.manage"),
  },
  {
    key: "hiring-interviews",
    label: "hiringInterviews",
    href: "/hiring/interviews",
    show: hiring("hiring.view"),
    match: ["/hiring/evaluations"],
  },
  {
    key: "hiring-offers",
    label: "hiringOffers",
    href: "/hiring/offers",
    show: hiring("hiring.manage"),
  },
  {
    key: "hiring-close-out",
    label: "hiringCloseOut",
    href: "/hiring/close-out",
    show: hiring("hiring.manage"),
  },
  {
    key: "hiring-approvals",
    label: "hiringApprovals",
    href: "/hiring/approvals",
    show: hiring("hiring.view"),
  },
  {
    key: "hiring-sourcing",
    label: "hiringSourcing",
    href: "/hiring/sourcing",
    show: hiring("hiring.manage"),
  },
  {
    key: "hiring-library",
    label: "hiringLibrary",
    href: "/hiring/library",
    show: hiring("hiring.manage"),
  },
];

/** One Insights hub: each tab is the module's own report screen, behind its own permission. */
export const INSIGHTS_TABS: readonly NavLink[] = [
  { key: "executive", label: "insightsExecutive", href: "/executive", show: orgWide },
  { key: "reports", label: "insightsPerformance", href: "/reports", show: orgWide },
  {
    key: "jml-reports",
    label: "insightsLifecycle",
    href: "/jml/reports",
    show: jml("jml.viewReports"),
  },
  {
    key: "hiring-insights",
    label: "insightsHiring",
    href: "/hiring/insights",
    show: hiring("hiring.view"),
  },
  {
    key: "ticket-reports",
    label: "insightsTickets",
    href: "/tickets/reports",
    show: (c) => c.hive.viewReports,
  },
];

/**
 * Admin › Settings (UX review R9): one tab per area, each the area's existing
 * page re-parented under the hub. General lists the areas the viewer may open.
 */
export const SETTING_AREAS: readonly NavLink[] = [
  { key: "org-setup", label: "orgSetup", href: "/admin/org-setup", show: (c) => c.pms.orgManage },
  {
    key: "email-templates",
    label: "settingsEmail",
    href: "/admin/settings/email-templates",
    show: (c) => [c.jml("jml.configure"), c.hive.editContent].some(Boolean),
  },
  {
    key: "import",
    label: "settingsImports",
    href: "/admin/import",
    show: (c) => c.pms.previewImport,
  },
  {
    key: "performance-settings",
    label: "settingsPerformance",
    href: "/admin/settings/performance",
    show: hr,
  },
  {
    key: "jml-settings",
    label: "settingsJml",
    href: "/jml/settings",
    show: (c) => [c.jml("jml.configure"), c.jml("jml.verifyStatutory")].some(Boolean),
  },
  {
    key: "hiring-settings",
    label: "settingsHiring",
    href: "/hiring/settings",
    show: hiring("hiring.configure"),
  },
  {
    key: "ticket-setup",
    label: "settingsTickets",
    href: "/tickets/setup",
    show: (c) => [c.hive.editContent, c.hive.configure].some(Boolean),
  },
];
export const anySetting: Gate = (c) => SETTING_AREAS.some((area) => area.show(c));
