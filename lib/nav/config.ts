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

export type NavContext = {
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

export type NavEntry = NavLink & { group: NavGroup; icon: NavIcon; tabs?: readonly NavLink[] };

export const NAV: readonly NavEntry[] = [
  { key: "home", group: "home", icon: "home", label: "home", href: "/", show: always },

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
    icon: "briefcase",
    label: "hiring",
    href: "/hiring",
    show: byTabs,
    tabs: HIRING_TABS,
  },
  {
    key: "performance-cycles",
    group: "talent",
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
    icon: "inbox",
    label: "tickets",
    href: "/tickets",
    show: (c) => c.hive.seeTickets,
  },

  // INSIGHTS — one hub; each tab is the module's own report screen.
  {
    key: "insights",
    group: "insights",
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
    key: "audit-log",
    group: "admin",
    icon: "audit",
    label: "auditLog",
    href: "/audit-log",
    show: admin,
  },
  // Scaffolded entities land here — `/scaffold-entity` inserts an entry above the recycling bin.
  {
    key: "recycling-bin",
    group: "admin",
    icon: "trash",
    label: "recyclingBin",
    href: "/recycling-bin",
    show: admin,
  },
];
