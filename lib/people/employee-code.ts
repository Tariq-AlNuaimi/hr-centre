import { auditedTransaction, prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";

/**
 * The EMP code (JML S1, ADR-075) — HR Onboarding §14.1 / BR-003 / BR-021 /
 * AC-ID-001, ported from `lib/services/onboarding/employee-id.ts` onto the core
 * `Employee.employeeCode` column and `EmployeeCodeSequence` singleton.
 *
 * "Use one shared EMP0001 sequence across all companies; never reuse IDs." The
 * sequence seeds ABSENT: until HR records the last manually issued code, JOIN
 * activation is hard-blocked (no placeholder sequence, no override for anyone).
 * Allocation takes `SELECT … FOR UPDATE` inside the caller's transaction so two
 * concurrent activations read distinct values.
 */

const NOT_CONFIGURED_MESSAGE =
  "The employee code cutover has not been configured. An administrator must record the " +
  "last manually issued code, the next system code, the cutover time and the approver before " +
  "any onboarding can be activated.";

const SEQUENCE_SELECT = {
  id: true,
  prefix: true,
  digits: true,
  lastManualId: true,
  nextValue: true,
  cutoverAt: true,
  approvedBy: true,
  updatedAt: true,
} as const;

type LockedRow = { id: string; prefix: string; digits: number; nextValue: number };

type RawTx = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/** Largest value expressible in `digits` digits — 4 → 9999. */
function maxValue(digits: number): number {
  return 10 ** digits - 1;
}

async function lockSequence(tx: RawTx): Promise<LockedRow | null> {
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT "id", "prefix", "digits", "next_value" AS "nextValue"
    FROM "employee_code_sequence"
    WHERE "singleton" = 'singleton'
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** `EMP` + zero-padded value: (EMP, 4, 312) → "EMP0312". */
export function formatEmployeeCode(prefix: string, digits: number, value: number): string {
  return `${prefix}${String(value).padStart(digits, "0")}`;
}

/** The numeric part of a code, or null if it is not exactly PREFIX + `digits` digits. */
export function parseEmployeeCode(prefix: string, digits: number, code: string): number | null {
  if (!/^[A-Z]+$/.test(prefix)) return null;
  const match = new RegExp(`^${prefix}(\\d{${digits}})$`).exec(code);
  return match ? Number(match[1]) : null;
}

export async function getEmployeeCodeSequence() {
  return prisma.employeeCodeSequence.findUnique({
    where: { singleton: "singleton" },
    select: SEQUENCE_SELECT,
  });
}

/** Bound on the registered-codes read at cutover (a pre-go-live population). */
const MAX_REGISTERED_CODES = 5000;

/** The highest code with `prefix` already on an employee (width-tolerant), or null. */
async function highestRegistered(prefix: string): Promise<{ code: string; value: number } | null> {
  const rows = await prisma.employee.findMany({
    where: { employeeCode: { startsWith: prefix } },
    select: { employeeCode: true },
    orderBy: { createdAt: "desc" },
    take: MAX_REGISTERED_CODES,
  });
  let best: { code: string; value: number } | null = null;
  for (const { employeeCode } of rows) {
    const rest = employeeCode?.slice(prefix.length) ?? "";
    if (!/^\d+$/.test(rest)) continue;
    const value = Number(rest);
    if (!best || value > best.value) best = { code: employeeCode!, value };
  }
  return best;
}

export type ConfigureEmployeeCodeInput = {
  prefix: string;
  digits: number;
  lastManualId: string;
  nextValue: number;
  cutoverAt: Date;
  approvedBy: string;
};

/**
 * Record or correct the cutover. At first configuration `nextValue` must be
 * `lastManualId + 1`; afterwards it may only move forward. Must also sit above
 * every code HR already recorded on an employee.
 */
export async function configureEmployeeCodeSequence(input: ConfigureEmployeeCodeInput) {
  const { prefix, digits, lastManualId, nextValue, cutoverAt, approvedBy } = input;
  const lastManualValue = parseEmployeeCode(prefix, digits, lastManualId);
  if (lastManualValue === null) {
    throw new OrgRuleError(
      `The last manual code must look like ${formatEmployeeCode(prefix, digits, 1)} — ` +
        `the prefix "${prefix}" followed by ${digits} digits`,
      400,
    );
  }
  if (nextValue > maxValue(digits)) {
    throw new OrgRuleError(
      `The next system code ${nextValue} does not fit in ${digits} digits — the widest code ` +
        `this format can issue is ${formatEmployeeCode(prefix, digits, maxValue(digits))}`,
      400,
    );
  }
  const highest = await highestRegistered(prefix);
  if (highest && nextValue <= highest.value) {
    throw new OrgRuleError(
      `${highest.code} is already recorded on an employee, so the next system code must be ` +
        `above it (${formatEmployeeCode(prefix, digits, highest.value + 1)} or later)`,
    );
  }

  return auditedTransaction(async (tx) => {
    const existing = await lockSequence(tx);
    const data = { prefix, digits, lastManualId, nextValue, cutoverAt, approvedBy };
    if (!existing) {
      if (nextValue !== lastManualValue + 1) {
        throw new OrgRuleError(
          `The next system code must be the next unused number after ${lastManualId}, which is ` +
            formatEmployeeCode(prefix, digits, lastManualValue + 1),
          400,
        );
      }
      try {
        return await tx.employeeCodeSequence.create({ data, select: SEQUENCE_SELECT });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          throw new OrgRuleError(
            "The employee code cutover was configured by someone else a moment ago — reload " +
              "and check the recorded values before changing them",
          );
        }
        throw e;
      }
    }
    if (nextValue < existing.nextValue) {
      throw new OrgRuleError(
        `The next system code cannot move backward from ${formatEmployeeCode(
          existing.prefix,
          existing.digits,
          existing.nextValue,
        )} — a code is never reused (BR-003)`,
      );
    }
    return tx.employeeCodeSequence.update({
      where: { id: existing.id },
      data,
      select: SEQUENCE_SELECT,
    });
  });
}

/** A refusal from allocation; the caller maps it onto its own error type. */
export class EmployeeCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeCodeError";
  }
}

type AllocationTx = RawTx & {
  employeeCodeSequence: {
    update(args: { where: { id: string }; data: { nextValue: number } }): Promise<unknown>;
  };
  employee: {
    findUnique(args: {
      where: { employeeCode: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * Allocate the next code inside the caller's transaction (call it LAST, so the
 * lock is held briefly). A code already on an employee is refused — never an
 * override (BR-022).
 */
export async function allocateEmployeeCode(tx: AllocationTx): Promise<string> {
  const row = await lockSequence(tx);
  if (!row) throw new EmployeeCodeError(NOT_CONFIGURED_MESSAGE);
  const value = Number(row.nextValue);
  const digits = Number(row.digits);
  if (value > maxValue(digits)) {
    throw new EmployeeCodeError(
      `The ${row.prefix} sequence has exhausted its ${digits}-digit range. An administrator must ` +
        `widen the code width before another onboarding can be activated.`,
    );
  }
  await tx.employeeCodeSequence.update({ where: { id: row.id }, data: { nextValue: value + 1 } });
  const code = formatEmployeeCode(row.prefix, digits, value);
  const taken = await tx.employee.findUnique({
    where: { employeeCode: code },
    select: { id: true },
  });
  if (taken) {
    throw new EmployeeCodeError(
      `Employee code ${code} is already in use. Codes are never reused (BR-022) — an ` +
        `administrator must move the next system code past it.`,
    );
  }
  return code;
}

const EMPLOYEE_CODE_PATTERN = /^[A-Z]{1,10}[0-9]{1,10}$/;

/**
 * HR records the code of an EXISTING employee (Onboarding R2): the code must be
 * free and, once the cutover exists, below the range the system issues.
 */
export async function recordEmployeeCode(employeeId: string, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  if (!EMPLOYEE_CODE_PATTERN.test(code)) {
    throw new OrgRuleError("employeeCode: use letters followed by digits, e.g. EMP0042", 400);
  }
  const sequence = await getEmployeeCodeSequence();
  if (sequence) {
    const value = parseEmployeeCode(sequence.prefix, sequence.digits, code);
    if (value === null) {
      throw new OrgRuleError(
        `employeeCode: must look like ${formatEmployeeCode(sequence.prefix, sequence.digits, 1)}`,
        400,
      );
    }
    if (value >= sequence.nextValue) {
      throw new OrgRuleError(
        `employeeCode: ${code} is in the range the system issues automatically ` +
          `(from ${formatEmployeeCode(sequence.prefix, sequence.digits, sequence.nextValue)})`,
      );
    }
  }
  const [target, holder] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeCode: true },
    }),
    prisma.employee.findUnique({ where: { employeeCode: code }, select: { id: true } }),
  ]);
  if (!target) throw new OrgRuleError("That employee does not exist", 404);
  if (target.employeeCode) {
    throw new OrgRuleError(
      `employeeCode: this employee already has ${target.employeeCode} — codes never change`,
    );
  }
  if (holder) throw new OrgRuleError(`employeeCode: ${code} already belongs to another employee`);
  try {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { employeeCode: code },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      throw new OrgRuleError(`employeeCode: ${code} already belongs to another employee`);
    }
    throw e;
  }
  return code;
}
