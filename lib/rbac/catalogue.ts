/**
 * The permission catalogue — blueprint §3 (F-c). In code, versioned with the
 * routes that check it: a permission is a promise a route keeps, so it cannot
 * be invented from a screen.
 *
 * Pure data (no Prisma), so the role builder renders it client-side and the
 * contract tests can pin the starter roles.
 *
 * SCOPE NOTE (this release): `people.*` and `logins.manage` honour an
 * assignment's scope (a company, directorate or department). The Performance
 * permissions (`perf.*`), `org.manage` and `imports.*` act org-wide, so ONLY a
 * Group-scoped grant of them counts — a scoped grant fails closed rather than
 * acting outside its scope. `SCOPED_PERMISSIONS` is the list that honours scope.
 */

export const MODULES = ["people", "org", "imports", "logins", "perf", "tickets", "hiring"] as const;
export type ModuleKey = (typeof MODULES)[number];

export const PERMISSIONS = [
  { code: "people.view", module: "people" },
  { code: "people.edit", module: "people" },
  { code: "people.viewSalary", module: "people" },
  { code: "people.viewPersonal", module: "people" },
  { code: "people.viewIdDocuments", module: "people" },
  { code: "org.manage", module: "org" },
  { code: "imports.preview", module: "imports" },
  { code: "imports.apply", module: "imports" },
  { code: "logins.manage", module: "logins" },
  { code: "perf.runCycle", module: "perf" },
  { code: "perf.configure", module: "perf" },
  { code: "perf.calibrate", module: "perf" },
  { code: "perf.exportMaster", module: "perf" },
  { code: "perf.viewReports", module: "perf" },
  // HR tickets (the HIVE port — docs/blueprints/hive.md). `draft` and `approve`
  // honour an HR-pair scope (HR_PAIR / OWN_HR_PAIR, registered by
  // lib/hive/access.ts); the rest act group-wide only.
  { code: "tickets.see", module: "tickets" },
  { code: "tickets.draft", module: "tickets" },
  { code: "tickets.approve", module: "tickets" },
  { code: "tickets.editContent", module: "tickets" },
  { code: "tickets.configure", module: "tickets" },
  { code: "tickets.viewReports", module: "tickets" },
  // Hiring (docs/blueprints/hiring.md §2, ADR-080). Capability permissions…
  { code: "hiring.view", module: "hiring" },
  { code: "hiring.manage", module: "hiring" },
  { code: "hiring.viewComp", module: "hiring" },
  { code: "hiring.viewPii", module: "hiring" },
  { code: "hiring.viewDei", module: "hiring" },
  { code: "hiring.configure", module: "hiring" },
  { code: "hiring.erase", module: "hiring" },
  // …and the approval roles (Interview Hub's business roles): holding one makes
  // a person eligible for that step, in the scope the assignment covers.
  { code: "hiring.hrManager", module: "hiring" },
  { code: "hiring.hrSpecialist", module: "hiring" },
  { code: "hiring.hiringManager", module: "hiring" },
  { code: "hiring.panelist", module: "hiring" },
  { code: "hiring.departmentHead", module: "hiring" },
  { code: "hiring.director", module: "hiring" },
  { code: "hiring.operationsManager", module: "hiring" },
  { code: "hiring.operationsDirector", module: "hiring" },
  { code: "hiring.coo", module: "hiring" },
  { code: "hiring.ceo", module: "hiring" },
] as const satisfies ReadonlyArray<{ code: string; module: ModuleKey }>;

export type Permission = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: readonly Permission[] = PERMISSIONS.map((p) => p.code);

export function isPermission(value: string): value is Permission {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}

/** Permissions whose scope is honoured (see the scope note above). */
export const SCOPED_PERMISSIONS = new Set<Permission>([
  "people.view",
  "people.edit",
  "people.viewSalary",
  "people.viewPersonal",
  "people.viewIdDocuments",
  "logins.manage",
  // HR tickets — scoped to an HR Tag pair, not an org unit.
  "tickets.draft",
  "tickets.approve",
  // Hiring — a record is covered by its requisition's company / directorate /
  // department. `hiring.configure` and `hiring.erase` are org-wide (Group only).
  "hiring.view",
  "hiring.manage",
  "hiring.viewComp",
  "hiring.viewPii",
  "hiring.viewDei",
  "hiring.hrManager",
  "hiring.hrSpecialist",
  "hiring.hiringManager",
  "hiring.panelist",
  "hiring.departmentHead",
  "hiring.director",
  "hiring.operationsManager",
  "hiring.operationsDirector",
  "hiring.coo",
  "hiring.ceo",
]);

/** The modules the foundation's starter roles were written for (migration 20261026180000). */
const FOUNDATION_MODULES = new Set<ModuleKey>(["people", "org", "imports", "logins", "perf"]);

function moduleOf(code: Permission): ModuleKey {
  return PERMISSIONS.find((p) => p.code === code)!.module;
}

export type StarterKey = "HR_SUPER_ADMIN" | "HRBP" | "EXECUTIVE_VIEWER";

/**
 * The three starter roles, reproducing Performance's hard-coded roles EXACTLY
 * (AC-F3.4) — the contract tests run every existing Performance permission test
 * through these definitions. Admins may edit or delete them afterwards.
 *
 * Mirrored by migration 20261026180000 (which creates them and migrates
 * `Employee.pmsRoles` once); a contract test keeps the two in lockstep.
 */
export const STARTER_ROLES: ReadonlyArray<{
  key: StarterKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "HR_SUPER_ADMIN",
    name: "HR Super Admin",
    description: "Everything, including configuration, calibration and the master export.",
    // The foundation's catalogue as the migration created it — NOT every code:
    // a module's actions (e.g. HR tickets) are granted through that module's
    // own starter roles, so adding a module never silently widens this role.
    permissions: PERMISSION_CODES.filter((p) => FOUNDATION_MODULES.has(moduleOf(p))),
  },
  {
    key: "HRBP",
    name: "HRBP",
    description: "Runs the performance cycle and sees people; does not configure.",
    permissions: [
      "people.view",
      "people.viewSalary",
      "people.viewPersonal",
      "people.viewIdDocuments",
      "imports.preview",
      "perf.runCycle",
      "perf.viewReports",
    ],
  },
  {
    key: "EXECUTIVE_VIEWER",
    name: "Executive Viewer",
    description: "Read-only, organisation-wide, including salary.",
    permissions: ["people.view", "people.viewSalary", "perf.viewReports"],
  },
];
