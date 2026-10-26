import type {
  JmlCaseType,
  JmlChangeType,
  JmlComplianceCategory,
  JmlDateBasis,
  JmlStage,
  PrismaClient,
} from "../generated/prisma/client";

/**
 * Starter checklist templates — REAL configuration from the source artifacts,
 * seeded once per name (an existing template, any version, is never touched:
 * HR owns it after the first build). Task codes are stable so a template can
 * be compared across versions.
 */

export type SeedTask = {
  code: string;
  name: string;
  stage: JmlStage;
  sortOrder: number;
  offsetDays: number;
  mandatory: boolean;
  statutory?: boolean;
  complianceCategory?: JmlComplianceCategory;
  conditions?: Record<string, { in?: string[]; notIn?: string[] }>;
};

export type SeedTemplate = {
  name: string;
  caseType: JmlCaseType;
  changeType?: JmlChangeType;
  dateBasis: JmlDateBasis;
  tasks: SeedTask[];
};

const t = (
  sortOrder: number,
  stage: JmlStage,
  name: string,
  offsetDays: number,
  mandatory: boolean,
  extra: Partial<SeedTask> = {},
): SeedTask => ({
  code: `T${String(sortOrder).padStart(2, "0")}`,
  name,
  stage,
  sortOrder,
  offsetDays,
  mandatory,
  ...extra,
});

const PRE = "PREBOARDING" as const;
const FD = "FIRST_DAY" as const;
const FW = "FIRST_WEEK" as const;

const NOT_OMANI = { nationality: { notIn: ["Omani"] } };
const OMANI = { nationality: { in: ["Omani"] } };
const PAYROLL = { payrollApplicable: { in: ["yes"] } };

/**
 * HR Onboarding §10.2 — the 36-task starter checklist (`prisma/seeds/
 * starter-template.ts`), offsets in calendar days from the planned start,
 * rolled forward off non-working days. Port fixes: the payroll task is
 * conditional on Payroll Applicable (BR-005, 8.4.12), the visa task skips
 * Omani joiners (BR-006) and the MOL registration applies to Omani joiners only.
 */
export const STARTER_JOIN_TEMPLATE: SeedTemplate = {
  name: "Standard onboarding (§10.2 starter)",
  caseType: "JOIN",
  dateBasis: "START_DATE",
  tasks: [
    t(0, PRE, "Send onboarding email", -21, true),
    t(1, PRE, "Generate employee ID", -21, true),
    t(2, PRE, "Start visa process when applicable", -21, false, {
      statutory: true,
      complianceCategory: "VISA",
      conditions: NOT_OMANI,
    }),
    t(3, PRE, "Receive signed offer", -14, true),
    t(4, PRE, "Receive Civil ID where applicable", -14, false),
    t(5, PRE, "Receive passport", -14, false),
    t(6, PRE, "Receive qualification", -14, true),
    t(7, PRE, "Receive ROP clearance", -10, true, {
      statutory: true,
      complianceCategory: "ROP_CLEARANCE",
    }),
    t(8, PRE, "Receive passport-size picture", -10, false),
    t(9, PRE, "Receive introduction/hobbies", -10, false),
    t(10, PRE, "Send NDA through Odoo", -10, true),
    t(11, PRE, "Send onboarding form through Odoo", -10, true),
    t(12, PRE, "Confirm NDA completion", -7, true),
    t(13, PRE, "Confirm completion", -7, true),
    t(14, PRE, "Submit IT request", -7, true),
    t(15, PRE, "Prepare Omani medical-fit letter when applicable", -7, false),
    t(16, PRE, "Complete internal verification for applicable full-time expatriates", -7, false),
    t(20, FD, "Welcome employee", 0, true),
    t(21, FD, "Conduct orientation", 0, true),
    t(22, FD, "Hand over laptop", 0, true),
    t(23, FD, "Confirm credentials shared", 0, true),
    t(24, FD, "Confirm access card issued", 0, true),
    t(25, FD, "Sign employment contract", 0, true),
    t(26, FD, "Share Trust Code email and acknowledgement links", 0, true),
    t(27, FD, "Issue welcome kit", 0, false),
    t(28, FD, "Complete office tour", 0, false),
    t(29, FD, "Take welcome picture", 0, false),
    t(30, FD, "Send welcome email", 0, false),
    t(40, FW, "Add employee to payroll sheet when Payroll Applicable = Yes", 1, false, {
      conditions: PAYROLL,
    }),
    t(41, FW, "Create Odoo employee profile", 2, true),
    t(42, FW, "Add employee to Staffing Form", 2, true),
    t(43, FW, "Add employee to employee distribution list", 2, false),
    t(44, FW, "Send insurance addition request", 3, true),
    t(45, FW, "Register applicable Omani employee in MOL", 5, false, {
      statutory: true,
      complianceCategory: "MOL",
      conditions: OMANI,
    }),
    t(46, FW, "Confirm employment contract signed", 5, true),
    t(47, FW, "Track medical card status", 7, false),
  ],
};

const EMPLOYMENT_CHANGE_TASKS: SeedTask[] = [
  t(0, PRE, "Issue employment offer", -14, true),
  t(1, PRE, "Start visa process when applicable", -14, false, {
    statutory: true,
    complianceCategory: "VISA",
    conditions: NOT_OMANI,
  }),
  t(2, PRE, "Receive signed offer", -7, true),
  t(3, PRE, "Submit IT request for any access changes", -3, false),
  t(10, FD, "Sign employment contract", 0, true),
  t(11, FD, "Update Odoo employee profile", 0, true),
  t(12, FD, "Update Staffing Form", 0, true),
  t(20, FW, "Add employee to payroll sheet when Payroll Applicable = Yes", 1, false, {
    conditions: PAYROLL,
  }),
  t(21, FW, "Send insurance addition request", 3, true),
  t(22, FW, "Register applicable Omani employee in MOL", 5, false, {
    statutory: true,
    complianceCategory: "MOL",
    conditions: OMANI,
  }),
  t(23, FW, "Confirm employment contract signed", 5, true),
];

/**
 * HR Onboarding's four internal-change starters (`prisma/seeds/change-templates.ts`,
 * one per change type, offsets in calendar days from the effective date) — the
 * build's proposal, edited by HR. Seeded only when no template of that change
 * type exists (active or not).
 */
export const STARTER_MOVE_TEMPLATES: SeedTemplate[] = [
  {
    name: "Internship to training (starter)",
    caseType: "MOVE",
    changeType: "INTERNSHIP_TO_TRAINING",
    dateBasis: "EFFECTIVE_DATE",
    tasks: [
      t(0, PRE, "Issue training offer letter", -7, true),
      t(1, PRE, "Receive signed training offer", -3, true),
      t(10, FD, "Update Odoo employee profile", 0, true),
      t(11, FD, "Update Staffing Form", 0, true),
      t(20, FW, "Add employee to payroll sheet when Payroll Applicable = Yes", 1, false, {
        conditions: PAYROLL,
      }),
      t(21, FW, "Agree training plan with line manager", 5, true),
    ],
  },
  {
    name: "Internship to employment (starter)",
    caseType: "MOVE",
    changeType: "INTERNSHIP_TO_EMPLOYMENT",
    dateBasis: "EFFECTIVE_DATE",
    tasks: EMPLOYMENT_CHANGE_TASKS,
  },
  {
    name: "Training to employment (starter)",
    caseType: "MOVE",
    changeType: "TRAINING_TO_EMPLOYMENT",
    dateBasis: "EFFECTIVE_DATE",
    tasks: EMPLOYMENT_CHANGE_TASKS,
  },
  {
    name: "Department transfer (starter)",
    caseType: "MOVE",
    changeType: "DEPARTMENT_TRANSFER",
    dateBasis: "EFFECTIVE_DATE",
    tasks: [
      t(0, PRE, "Confirm transfer with current and new line managers", -7, true),
      t(1, PRE, "Issue transfer letter", -3, true),
      t(2, PRE, "Submit IT request for access changes", -3, true),
      t(10, FD, "Update Odoo employee profile", 0, true),
      t(11, FD, "Update Staffing Form", 0, true),
      t(20, FW, "Update employee distribution lists", 2, false),
      t(21, FW, "Complete handover from previous department", 5, false),
    ],
  },
];

/** Create a template once (by name); never update an existing one. */
export async function seedTemplateOnce(prisma: PrismaClient, tpl: SeedTemplate): Promise<boolean> {
  const exists = await prisma.jmlTaskTemplate.findFirst({
    where: {
      OR: [
        { name: tpl.name },
        ...(tpl.changeType ? [{ caseType: tpl.caseType, changeType: tpl.changeType }] : []),
      ],
    },
    select: { id: true },
  });
  if (exists) return false;
  const created = await prisma.jmlTaskTemplate.create({
    data: {
      name: tpl.name,
      version: 1,
      active: true,
      caseType: tpl.caseType,
      changeType: tpl.changeType ?? null,
      criteria: {},
    },
    select: { id: true },
  });
  for (const task of tpl.tasks) {
    await prisma.jmlTemplateTask.create({
      data: {
        templateId: created.id,
        code: task.code,
        name: task.name,
        stage: task.stage,
        sortOrder: task.sortOrder,
        dateBasis: tpl.dateBasis,
        offsetDays: task.offsetDays,
        offsetUnit: "CALENDAR_DAYS",
        mandatory: task.mandatory,
        statutory: task.statutory ?? false,
        complianceCategory: task.complianceCategory ?? null,
        conditions: task.conditions ?? {},
      },
      select: { id: true },
    });
  }
  return true;
}
