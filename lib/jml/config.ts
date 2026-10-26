import type { ContractType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE, type WorkingSchedule } from "@/lib/working-time/calendar";
import { isStatutoryKey } from "@/lib/statutory/parameters";
import { JmlError } from "./errors";

/**
 * JML configuration services — the screens Onboarding and Offboarding each had
 * for their own copy, now over the ONE core configuration (D3, D4) plus the
 * module's lookups. All writes find-then-write (never `upsert`: it bypasses the
 * audit extension, ADR-010).
 */

const unique = (e: unknown) => (e as { code?: string }).code === "P2002";

// --- Working schedule + public holidays (ADR-077) ---------------------------

export async function getSchedule(): Promise<WorkingSchedule & { isDefault: boolean }> {
  const row = await prisma.workingSchedule.findUnique({
    where: { singleton: "singleton" },
    select: { workingDays: true, startHour: true, endHour: true, timeZone: true },
  });
  return row
    ? { ...row, isDefault: false }
    : { ...DEFAULT_SCHEDULE, workingDays: [...DEFAULT_SCHEDULE.workingDays], isDefault: true };
}

export async function saveSchedule(input: WorkingSchedule) {
  const data = {
    workingDays: [...new Set(input.workingDays)].sort((a, b) => a - b),
    startHour: input.startHour,
    endHour: input.endHour,
    timeZone: input.timeZone,
  };
  const existing = await prisma.workingSchedule.findUnique({
    where: { singleton: "singleton" },
    select: { id: true },
  });
  if (existing) {
    await prisma.workingSchedule.update({ where: { id: existing.id }, data, select: { id: true } });
  } else {
    await prisma.workingSchedule.create({ data, select: { id: true } });
  }
  return getSchedule();
}

export function listHolidays(year: number) {
  return prisma.publicHoliday.findMany({
    where: {
      date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
    },
    orderBy: { date: "asc" },
    take: 366,
    select: { id: true, date: true, name: true },
  });
}

export async function addHoliday(date: Date, name: string) {
  try {
    return await prisma.publicHoliday.create({
      data: { date, name },
      select: { id: true, date: true, name: true },
    });
  } catch (e) {
    if (unique(e)) throw new JmlError("That date is already a public holiday");
    throw e;
  }
}

export async function removeHoliday(id: string) {
  const found = await prisma.publicHoliday.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw new JmlError("Holiday not found", 404);
  await prisma.publicHoliday.delete({ where: { id } });
}

// --- Statutory parameters (Offboarding §2.10, US16) --------------------------

const PARAM_SELECT = {
  id: true,
  key: true,
  value: true,
  effectiveFrom: true,
  effectiveTo: true,
  verified: true,
  verifiedAt: true,
  note: true,
  verifiedBy: { select: { id: true, name: true } },
} as const;

type ParamRow = Prisma.StatutoryParameterGetPayload<{ select: typeof PARAM_SELECT }>;
const serializeParam = (r: ParamRow) => ({ ...r, value: r.value.toString() });

export async function listStatutory(key?: string) {
  const rows = await prisma.statutoryParameter.findMany({
    where: key ? { key } : {},
    orderBy: [{ key: "asc" }, { effectiveFrom: "asc" }],
    take: 500,
    select: PARAM_SELECT,
  });
  const unverified = rows.filter((r) => !r.verified);
  return {
    rows: rows.map(serializeParam),
    unverifiedCount: unverified.length,
    unverifiedKeys: [...new Set(unverified.map((r) => r.key))],
  };
}

export async function createStatutory(input: {
  key: string;
  value: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string | null;
}) {
  if (!isStatutoryKey(input.key))
    throw new JmlError("key: not a statutory parameter this system reads", 422);
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    throw new JmlError("effectiveTo: must be after effectiveFrom", 422);
  }
  try {
    // Always created UNVERIFIED — verification is a separate HR Manager act.
    const row = await prisma.statutoryParameter.create({
      data: { ...input, verified: false },
      select: PARAM_SELECT,
    });
    return serializeParam(row);
  } catch (e) {
    if (unique(e)) throw new JmlError("A row for that key already starts on that date");
    throw e;
  }
}

export async function verifyStatutory(
  id: string,
  verified: boolean,
  sourceReference: string | null,
  actorUserId: string,
) {
  if (verified && !sourceReference?.trim()) {
    throw new JmlError(
      "A source reference is required — the Labour Law article, Ministerial Decision or payroll " +
        "circular the figure was checked against.",
      422,
    );
  }
  const existing = await prisma.statutoryParameter.findUnique({
    where: { id },
    select: { id: true, note: true },
  });
  if (!existing) throw new JmlError("Statutory parameter not found", 404);
  const row = await prisma.statutoryParameter.update({
    where: { id },
    data: verified
      ? {
          verified: true,
          verifiedById: actorUserId,
          verifiedAt: new Date(),
          note: [existing.note, `Verified against: ${sourceReference!.trim()}`]
            .filter(Boolean)
            .join("\n"),
        }
      : { verified: false, verifiedById: null, verifiedAt: null },
    select: PARAM_SELECT,
  });
  const remaining = await prisma.statutoryParameter.count({ where: { verified: false } });
  return {
    parameter: serializeParam(row),
    remainingUnverified: remaining,
    o1Closed: remaining === 0,
  };
}

// --- Position classifications (core lookup, Offboarding C8; ships empty) ----

export function listPositionClassifications(includeInactive: boolean) {
  return prisma.positionClassification.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    take: 500,
    select: { id: true, code: true, label: true, active: true, sortOrder: true },
  });
}

export async function createPositionClassification(input: {
  code: string;
  label: string;
  sortOrder: number;
}) {
  try {
    return await prisma.positionClassification.create({
      data: input,
      select: { id: true, code: true, label: true, active: true, sortOrder: true },
    });
  } catch (e) {
    if (unique(e)) throw new JmlError("That code is already used (it may be deactivated)");
    throw e;
  }
}

export async function updatePositionClassification(
  id: string,
  input: { label?: string; sortOrder?: number; active?: boolean },
) {
  const found = await prisma.positionClassification.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!found) throw new JmlError("Classification not found", 404);
  return prisma.positionClassification.update({
    where: { id },
    data: input,
    select: { id: true, code: true, label: true, active: true, sortOrder: true },
  });
}

// --- Contract types (Onboarding §7.4: HR's approved list, seeded empty) -----

const CONTRACT_SELECT = {
  id: true,
  name: true,
  code: true,
  sortOrder: true,
  active: true,
  createdAt: true,
} as const;

export function listContractTypes(includeInactive: boolean) {
  return prisma.jmlContractType.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 200,
    select: CONTRACT_SELECT,
  });
}

export async function createContractType(input: { name: string; code: string; sortOrder: number }) {
  try {
    return await prisma.jmlContractType.create({ data: input, select: CONTRACT_SELECT });
  } catch (e) {
    if (unique(e)) throw new JmlError("A contract type with that name or code already exists");
    throw e;
  }
}

export async function updateContractType(
  id: string,
  input: { name?: string; code?: string; sortOrder?: number; active?: boolean },
) {
  const found = await prisma.jmlContractType.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw new JmlError("Contract type not found", 404);
  try {
    return await prisma.jmlContractType.update({
      where: { id },
      data: input,
      select: CONTRACT_SELECT,
    });
  } catch (e) {
    if (unique(e)) throw new JmlError("A contract type with that name or code already exists");
    throw e;
  }
}

// --- Employment-type configuration (Onboarding EmploymentTypeConfig) --------

export function listEmploymentTypeConfigs() {
  return prisma.jmlEmploymentTypeConfig.findMany({
    orderBy: [{ sortOrder: "asc" }],
    take: 50,
    select: {
      employmentType: true,
      active: true,
      defaultTemplateId: true,
      payrollApplicableDefault: true,
      notes: true,
      sortOrder: true,
    },
  });
}

/** Creates the row on demand (a type without one behaves as the defaults). */
export async function saveEmploymentTypeConfig(
  employmentType: ContractType,
  input: {
    active?: boolean;
    defaultTemplateId?: string | null;
    payrollApplicableDefault?: boolean;
    notes?: string | null;
    sortOrder?: number;
  },
) {
  if (input.defaultTemplateId) {
    const t = await prisma.jmlTaskTemplate.findUnique({
      where: { id: input.defaultTemplateId },
      select: { caseType: true },
    });
    if (t?.caseType !== "JOIN")
      throw new JmlError("defaultTemplateId: choose a joiner template", 422);
  }
  const existing = await prisma.jmlEmploymentTypeConfig.findUnique({
    where: { employmentType },
    select: { id: true },
  });
  if (existing) {
    return prisma.jmlEmploymentTypeConfig.update({ where: { employmentType }, data: input });
  }
  return prisma.jmlEmploymentTypeConfig.create({ data: { employmentType, ...input } });
}
