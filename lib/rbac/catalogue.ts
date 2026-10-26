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

export const MODULES = ["people", "org", "imports", "logins", "perf"] as const;
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
]);

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
    permissions: PERMISSION_CODES,
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
