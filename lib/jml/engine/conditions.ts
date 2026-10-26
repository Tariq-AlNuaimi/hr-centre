/**
 * Which template tasks apply to a case — pure, no I/O (it runs inside the
 * activation transaction).
 *
 * JOIN / MOVE — HR Onboarding `conditions.ts` (§14, BR-005/006/008), verbatim
 * semantics: per fact `{ in?, notIn? }`, all stated facts must match (AND),
 * compared trimmed + case-insensitively, a NULL fact matches (fail towards
 * generating the task), unreadable JSON = unconditional. One addition (port
 * defect 8.4.12): `payrollApplicable` ("yes" / "no") is a condition fact, so
 * BR-005's "no payroll task when Payroll Applicable = No" can be a real rule
 * instead of relying on the task being optional.

 * (LEAVE applicability lives in ./leave-applicability.ts.)
 */

export const CONDITION_FIELDS = [
  "companyId",
  "employmentType",
  "contractTypeId",
  "nationality",
  "workLocation",
  "payrollApplicable",
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

export type ConditionFacts = Record<ConditionField, string | null>;

type Rule = { in?: string[]; notIn?: string[] };
type Rules = Partial<Record<ConditionField, Rule>>;

const norm = (v: string) => v.trim().toLowerCase();

function ruleAdmits(rule: Rule, fact: string | null): boolean {
  if (fact === null) return true;
  const value = norm(fact);
  if (rule.in && !rule.in.some((c) => norm(c) === value)) return false;
  if (rule.notIn && rule.notIn.some((c) => norm(c) === value)) return false;
  return true;
}

export function readConditions(value: unknown): Rules | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const rules: Rules = {};
  for (const field of CONDITION_FIELDS) {
    const raw = source[field];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const parsed: Rule = {};
    if (Array.isArray(r.in)) parsed.in = r.in.filter((v): v is string => typeof v === "string");
    if (Array.isArray(r.notIn)) {
      parsed.notIn = r.notIn.filter((v): v is string => typeof v === "string");
    }
    if (parsed.in?.length || parsed.notIn?.length) rules[field] = parsed;
  }
  return rules;
}

/** Do this template task's conditions admit the case? */
export function taskApplies(conditions: unknown, facts: ConditionFacts): boolean {
  const rules = readConditions(conditions);
  if (!rules) return true;
  for (const field of CONDITION_FIELDS) {
    const rule = rules[field];
    if (rule && !ruleAdmits(rule, facts[field])) return false;
  }
  return true;
}

/** The conditions that applied (stored on the task), or null when unconditional. */
export function conditionSource(conditions: unknown): Rules | null {
  const rules = readConditions(conditions);
  return rules && Object.keys(rules).length > 0 ? rules : null;
}

/**
 * Template CRITERIA (BR-004): each pinned key must equal the case's value,
 * absent = wildcard; the score is the number of pinned keys. Compared trimmed
 * and case-insensitively — Onboarding compared criteria case-SENSITIVELY but
 * conditions insensitively, so "Omani" pinned a template that "omani" missed
 * (port defect 8.4.9). Returns null when a pinned criterion does not match.
 */
export function criteriaScore(criteria: unknown, facts: ConditionFacts): number | null {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) return 0;
  let score = 0;
  for (const [key, expected] of Object.entries(criteria as Record<string, unknown>)) {
    if (typeof expected !== "string" || expected === "") continue;
    const actual = facts[key as ConditionField] ?? "";
    if (norm(actual) !== norm(expected)) return null;
    score += 1;
  }
  return score;
}
