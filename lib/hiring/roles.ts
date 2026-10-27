import type { Permission } from "@/lib/rbac/catalogue";

/**
 * Hiring starter roles — Interview Hub's business roles as role-builder
 * bundles (docs/blueprints/hiring.md §2, ADR-080). Pure data, seeded
 * idempotently by `prisma/seed-hiring.ts` (created only if no role carries the
 * key; an edited or deleted starter stays as the admin left it).
 *
 * The SCOPE lives on the assignment: give "HR Manager" for Codeline and that
 * person signs Codeline's requisitions and offers, nobody else's. Every
 * approval role is assignable here (Interview Hub defect D1).
 */

export type HiringStarterKey =
  | "HIRING_ADMIN"
  | "HIRING_HR_MANAGER"
  | "HIRING_HR_SPECIALIST"
  | "HIRING_HIRING_MANAGER"
  | "HIRING_PANELIST"
  | "HIRING_DEPARTMENT_HEAD"
  | "HIRING_DIRECTOR"
  | "HIRING_OPERATIONS_MANAGER"
  | "HIRING_OPERATIONS_DIRECTOR"
  | "HIRING_COO"
  | "HIRING_CEO";

const HR_CORE: Permission[] = [
  "hiring.view",
  "hiring.manage",
  "hiring.viewComp",
  "hiring.viewPii",
  "hiring.viewDei",
];

export const HIRING_STARTER_ROLES: ReadonlyArray<{
  key: HiringStarterKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "HIRING_ADMIN",
    name: "Hiring Admin",
    description:
      "Configures hiring (approval chains, AI, letter, assessment) and may erase candidate data. Give for the whole group.",
    permissions: [...HR_CORE, "hiring.configure", "hiring.erase", "hiring.hrManager"],
  },
  {
    key: "HIRING_HR_MANAGER",
    name: "HR Manager",
    description: "Runs hiring; signs requisitions, JDs and offers as HR Manager (Sr HRBP).",
    permissions: [...HR_CORE, "hiring.hrManager"],
  },
  {
    key: "HIRING_HR_SPECIALIST",
    name: "HR Specialist",
    description: "Runs hiring day to day; signs JDs for HR.",
    permissions: [...HR_CORE, "hiring.hrSpecialist"],
  },
  {
    key: "HIRING_HIRING_MANAGER",
    name: "Hiring Manager",
    description: "Raises hiring requests and works their candidates; pay only where allowed.",
    permissions: ["hiring.view", "hiring.manage", "hiring.viewPii", "hiring.hiringManager"],
  },
  {
    key: "HIRING_PANELIST",
    name: "Panelist",
    description: "Scores the interviews they sit on.",
    permissions: ["hiring.view", "hiring.panelist"],
  },
  {
    key: "HIRING_DEPARTMENT_HEAD",
    name: "Department Head",
    description: "Approves offers where an approval chain includes the department head.",
    permissions: ["hiring.view", "hiring.departmentHead"],
  },
  {
    key: "HIRING_DIRECTOR",
    name: "Director",
    description: "Approves offers where an approval chain includes a director.",
    permissions: ["hiring.view", "hiring.director"],
  },
  {
    key: "HIRING_OPERATIONS_MANAGER",
    name: "Operations Manager",
    description: "Approves offers where an approval chain includes the operations manager.",
    permissions: ["hiring.view", "hiring.operationsManager"],
  },
  {
    key: "HIRING_OPERATIONS_DIRECTOR",
    name: "Operations Director",
    description: "Second signature on requisitions and offers.",
    permissions: ["hiring.view", "hiring.viewComp", "hiring.operationsDirector"],
  },
  {
    key: "HIRING_COO",
    name: "COO",
    description: "Approves offers at or above the COO threshold.",
    permissions: ["hiring.view", "hiring.viewComp", "hiring.coo"],
  },
  {
    key: "HIRING_CEO",
    name: "CEO",
    description: "Approves offers where an approval chain includes the entity CEO.",
    permissions: ["hiring.view", "hiring.viewComp", "hiring.ceo"],
  },
];
