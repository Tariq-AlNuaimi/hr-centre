/**
 * HR Centre navigation — ONE typed definition feeding the sidebar, the ⌘K
 * palette, the module tab bars and the breadcrumbs (docs/blueprints/ux-p1-nav.md,
 * UX review R7). The sidebar is task-based (Home · Me · My team · People ·
 * Talent · Service · Insights · Admin), not grouped by the app each screen came
 * from. A module is ONE sidebar entry; its sub-pages are that entry's `tabs`,
 * rendered as an in-page tab bar.
 *
 * Gates are AFFORDANCES only — every route re-checks on the server. They read a
 * `NavContext` the client assembles from the access hooks the shell already
 * uses; an unresolved context holds nothing, so the nav fails closed.
 *
 * Paths here carry no locale prefix. Labels are keys in the `nav` message
 * namespace; `text` is a literal fallback used only by scaffolded entities.
 */

import type { Permission } from "@/lib/rbac/catalogue";
import {
  HIRING_TABS,
  INSIGHTS_TABS,
  JML_TABS,
  SETTING_AREAS,
  admin,
  always,
  anySetting,
  byTabs,
  hiring,
  hr,
  ownsRequisitions,
  teamLead,
  type Gate,
} from "./tabs";

export const NAV_GROUPS = [
  "home",
  "me",
  "team",
  "people",
  "talent",
  "service",
  "insights",
  "admin",
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/**
 * P2 (UX R22) — who the viewer is to the navigation. "employee" holds no HR,
 * manager, hiring, ticket or admin capability: they see Home, Me and the
 * people directory, and every HR tool is hidden by a second, explicit gate
 * (`personas: ["staff"]`) on top of each entry's own permission check.
 */
export type Persona = "employee" | "staff";

export type NavContext = {
  /** P2 (R22) — derived from the capabilities below; see `personaOf`. */
  persona: Persona;
  /** Platform administrator (`User.role = ADMIN`). */
  isAdmin: boolean;
  employeeId: string | null;
  pms: {
    hr: boolean;
    lineManager: boolean;
    orgWide: boolean;
    runCalibration: boolean;
    previewImport: boolean;
    orgManage: boolean;
    loginsManage: boolean;
  };
  hive: { seeTickets: boolean; viewReports: boolean; editContent: boolean; configure: boolean };
  /** Does the viewer hold this JML permission anywhere? */
  jml: (permission: Permission) => boolean;
  /** JML task routing: desk or line-manager tasks are routed to the viewer (derived). */
  jmlTaskWorker: boolean;
  /** Does the viewer hold this Hiring permission anywhere? */
  hiring: (permission: Permission) => boolean;
};

export type NavIcon =
  | "home"
  | "user"
  | "award"
  | "interviews"
  | "team"
  | "users"
  | "network"
  | "lifecycle"
  | "briefcase"
  | "cycles"
  | "inbox"
  | "insights"
  | "settings"
  | "shield"
  | "audit"
  | "trash"
  | "grid";

export type NavLink = {
  key: string;
  /** Message key under `nav`. */
  label: string;
  /** Literal label (scaffolded entities only). */
  text?: string;
  /** Path without locale; `null` when it cannot be built for this viewer. */
  href: string | ((ctx: NavContext) => string | null);
  show: Gate;
  /** Extra path prefixes this link owns (sub-pages that are not their own tab). */
  match?: readonly string[];
};

export type NavEntry = NavLink & {
  group: NavGroup;
  icon: NavIcon;
  tabs?: readonly NavLink[];
  /** P2 (R22) — personas this entry is for; absent = everyone it is otherwise shown to. */
  personas?: readonly Persona[];
};

/** P2 (R22) — "staff" when the viewer holds any HR, manager, hiring, ticket or admin capability. */
export function personaOf(ctx: Omit<NavContext, "persona">): Persona {
  const staff =
    ctx.isAdmin ||
    Object.values(ctx.pms).some(Boolean) ||
    Object.values(ctx.hive).some(Boolean) ||
    ctx.jmlTaskWorker ||
    ctx.jml("jml.view") ||
    ctx.hiring("hiring.view");
  return staff ? "staff" : "employee";
}

/** P2 (R22) — HR and manager tools: never shown to the employee persona. */
const STAFF_ONLY: readonly Persona[] = ["staff"];

export const NAV: readonly NavEntry[] = [
  { key: "home", group: "home", icon: "home", label: "home", href: "/", show: always },
  // ADR-094: every decision waiting on the viewer, across modules.
  {
    key: "approvals",
    group: "home",
    icon: "inbox",
    label: "approvals",
    href: "/approvals",
    // Anyone who can be routed (or delegated) an approval: hiring readers, JML
    // approval deciders and ticket staff. Others never have one waiting.
    show: (c) => c.hiring("hiring.view") || c.jml("jml.decideApprovals") || c.hive.seeTickets,
  },

  // ME — everyone with a login.
  {
    key: "me-profile",
    group: "me",
    icon: "user",
    label: "myProfile",
    href: (c) => (c.employeeId ? `/people/${c.employeeId}` : null),
    show: (c) => c.employeeId !== null,
  },
  {
    key: "me-performance",
    group: "me",
    icon: "award",
    label: "myPerformance",
    href: "/scorecard",
    show: byTabs,
    tabs: [
      { key: "scorecard", label: "scorecard", href: "/scorecard", show: always },
      { key: "mid-year", label: "midYear", href: "/mid-year", show: always },
      { key: "year-end", label: "yearEnd", href: "/year-end", show: always },
    ],
  },
  {
    // P2 (R22) — the employee's own HR self-service: their questions and documents.
    key: "me-hr",
    group: "me",
    icon: "inbox",
    label: "myHr",
    href: "/me/requests",
    show: byTabs,
    tabs: [
      {
        key: "me-requests",
        label: "myRequests",
        href: "/me/requests",
        show: (c) => c.employeeId !== null,
      },
      {
        key: "me-documents",
        label: "myDocuments",
        href: "/me/documents",
        show: (c) => c.employeeId !== null,
      },
    ],
  },
  {
    key: "me-interviews",
    group: "me",
    icon: "interviews",
    label: "myInterviews",
    href: "/hiring/panel",
    show: hiring("hiring.view"),
  },

  // MY TEAM — line managers (and HR, who see every team).
  {
    key: "team",
    group: "team",
    personas: STAFF_ONLY,
    icon: "team",
    label: "team",
    href: "/team",
    show: byTabs,
    tabs: [
      { key: "team-people", label: "teamPeople", href: "/team", show: teamLead },
      { key: "goal-setting", label: "goalSetting", href: "/goal-setting", show: teamLead },
      {
        key: "my-hiring",
        label: "myHiring",
        href: "/team/hiring",
        show: ownsRequisitions,
      },
    ],
  },

  // PEOPLE
  {
    key: "people",
    group: "people",
    icon: "users",
    label: "directory",
    href: "/people",
    show: always,
  },
  { key: "org", group: "people", icon: "network", label: "org", href: "/org", show: always },
  {
    key: "jml",
    group: "people",
    personas: STAFF_ONLY,
    icon: "lifecycle",
    label: "jmlHome",
    href: "/jml",
    show: byTabs,
    tabs: JML_TABS,
  },

  // TALENT
  {
    key: "hiring",
    group: "talent",
    personas: STAFF_ONLY,
    icon: "briefcase",
    label: "hiring",
    href: "/hiring",
    show: byTabs,
    tabs: HIRING_TABS,
  },
  {
    key: "performance-cycles",
    group: "talent",
    personas: STAFF_ONLY,
    icon: "cycles",
    label: "cycles",
    href: "/admin/cycles",
    show: byTabs,
    tabs: [
      { key: "cycles", label: "cyclesTab", href: "/admin/cycles", show: hr },
      { key: "three-sixty", label: "threeSixty", href: "/three-sixty", show: hr },
      {
        key: "calibration",
        label: "calibration",
        href: "/calibration",
        show: (c) => c.pms.runCalibration,
      },
      { key: "strategy-scores", label: "strategyScores", href: "/admin/strategy-scores", show: hr },
      { key: "edge-cases", label: "edgeCases", href: "/admin/edge-cases", show: hr },
    ],
  },

  // SERVICE
  {
    key: "tickets",
    group: "service",
    personas: STAFF_ONLY,
    icon: "inbox",
    label: "tickets",
    href: "/tickets",
    show: (c) => c.hive.seeTickets,
  },

  // INSIGHTS — one hub; each tab is the module's own report screen.
  {
    key: "insights",
    group: "insights",
    personas: STAFF_ONLY,
    icon: "insights",
    label: "insights",
    href: "/executive",
    show: byTabs,
    tabs: INSIGHTS_TABS,
  },

  // ADMIN
  {
    key: "settings",
    group: "admin",
    personas: STAFF_ONLY,
    icon: "settings",
    label: "settings",
    href: "/admin/settings",
    show: byTabs,
    tabs: [
      {
        key: "settings-general",
        label: "settingsGeneral",
        href: "/admin/settings",
        show: anySetting,
      },
      ...SETTING_AREAS,
    ],
  },
  {
    key: "roles-access",
    group: "admin",
    personas: STAFF_ONLY,
    icon: "shield",
    label: "rolesAccess",
    href: "/admin/roles",
    show: byTabs,
    tabs: [
      { key: "roles", label: "roles", href: "/admin/roles", show: admin },
      {
        key: "access",
        label: "access",
        href: "/admin/access",
        show: (c) => [c.isAdmin, c.pms.loginsManage].some(Boolean),
      },
    ],
  },
  {
    // ADR-095 follow-up: the audit log and the cross-module email log, one entry.
    key: "audit-log",
    group: "admin",
    personas: STAFF_ONLY,
    icon: "audit",
    label: "logs",
    href: "/audit-log",
    show: byTabs,
    tabs: [
      { key: "audit-log-events", label: "auditLog", href: "/audit-log", show: admin },
      { key: "email-log", label: "emailLog", href: "/admin/email-log", show: admin },
    ],
  },
  // Scaffolded entities land here — `/scaffold-entity` inserts an entry above the recycling bin.
  {
    key: "recycling-bin",
    group: "admin",
    personas: STAFF_ONLY,
    icon: "trash",
    label: "recyclingBin",
    href: "/recycling-bin",
    show: admin,
  },
];
