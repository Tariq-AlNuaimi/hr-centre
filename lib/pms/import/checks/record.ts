import type { ContractType, Gender } from "@/generated/prisma/client";
import { DATE_RECORD_FIELDS, RECORD_FIELDS, type EmployeeRecordInput } from "@/lib/people/record";
import type { EmployeeSourceRow, ImportIssue } from "../types";
import { issue, normalize, parseIsoDate, type Check } from "./shared";

/**
 * F-b — the record columns (blueprint §2, AC-F2.1). Every column is optional:
 * an absent column leaves the field on file alone (`undefined`), a blank cell
 * clears it (`null`). Rules match the form's zod schema (lib/validations/people.ts)
 * so the two ways in accept the same values (AC-F5.2).
 */

const CONTRACT_ALIASES: Record<string, ContractType> = {
  permanent: "PERMANENT",
  "fixed term": "FIXED_TERM",
  fixed: "FIXED_TERM",
  contract: "FIXED_TERM",
  intern: "INTERN",
  internship: "INTERN",
  "part time": "PART_TIME",
  parttime: "PART_TIME",
  secondment: "SECONDMENT",
  seconded: "SECONDMENT",
  // JML S1 (ADR-076) — the union of the onboarding/offboarding lists.
  "permanent full time": "PERMANENT",
  "full time": "PERMANENT",
  "permanent part time": "PART_TIME",
  "summer intern": "SUMMER_INTERN",
  "summer internship": "SUMMER_INTERN",
  trainee: "TRAINEE",
  training: "TRAINEE",
  freelancer: "FREELANCER",
  freelance: "FREELANCER",
  consultant: "CONSULTANT",
  consultancy: "CONSULTANT",
  contractor: "CONTRACTOR",
  temporary: "TEMPORARY",
  "temporary employee": "TEMPORARY",
  temp: "TEMPORARY",
};

const GENDER_ALIASES: Record<string, Gender> = {
  male: "MALE",
  m: "MALE",
  female: "FEMALE",
  f: "FEMALE",
};

const TEXT_LIMITS: Partial<Record<keyof EmployeeRecordInput, number>> = {
  jobTitle: 120,
  grade: 40,
  workLocation: 120,
  nationality: 60,
};

const PHONE = /^\+?[0-9 ()-]{6,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_NUMBER = /^[A-Z0-9]{4,20}$/;

type Parsed = { value: unknown } | { problem: string };

function parseField(field: keyof EmployeeRecordInput, raw: string): Parsed {
  if (DATE_RECORD_FIELDS.has(field)) {
    const date = parseIsoDate(raw);
    if (!date) return { problem: "Use a real date in YYYY-MM-DD form." };
    if (field === "dateOfBirth" && date > new Date()) {
      return { problem: "A date of birth cannot be in the future." };
    }
    return { value: date };
  }
  switch (field) {
    case "contractType": {
      const v = CONTRACT_ALIASES[normalize(raw)];
      return v
        ? { value: v }
        : {
            problem:
              "Use Permanent, Fixed term, Part time, Intern, Summer intern, Trainee, Secondment, " +
              "Freelancer, Consultant, Contractor or Temporary.",
          };
    }
    case "gender": {
      const v = GENDER_ALIASES[normalize(raw)];
      return v ? { value: v } : { problem: "Use Male or Female." };
    }
    case "workPhone":
    case "personalPhone":
      return PHONE.test(raw)
        ? { value: raw }
        : { problem: "Use digits, spaces, brackets or dashes, optionally starting with +." };
    case "personalEmail":
      return EMAIL.test(raw)
        ? { value: raw.toLowerCase() }
        : { problem: "Not a valid email address." };
    case "civilIdNumber":
    case "passportNumber": {
      const v = raw.replace(/\s+/g, "").toUpperCase();
      // The message never echoes the value: rejections are stored and shown.
      return ID_NUMBER.test(v)
        ? { value: v }
        : { problem: "Use 4–20 letters or digits, as printed on the document." };
    }
    default: {
      const limit = TEXT_LIMITS[field] ?? 120;
      return raw.length <= limit
        ? { value: raw }
        : { problem: `Keep it under ${limit} characters.` };
    }
  }
}

export function checkRecord(row: EmployeeSourceRow): Check<EmployeeRecordInput> {
  const issues: ImportIssue[] = [];
  const record: Record<string, unknown> = {};
  for (const field of RECORD_FIELDS) {
    const cell = row[field];
    if (cell === undefined) continue;
    const raw = cell?.trim() ?? "";
    if (raw === "") {
      record[field] = null;
      continue;
    }
    const parsed = parseField(field, raw);
    if ("problem" in parsed) {
      issues.push(issue(row, field, `${field}_invalid`, parsed.problem));
    } else {
      record[field] = parsed.value;
    }
  }
  return { value: record as EmployeeRecordInput, issues };
}
