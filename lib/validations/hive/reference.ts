import { z } from "zod";

/**
 * Boundary validation for HR tickets' reference data — the data Siraaj's tools
 * answer from (HR Tag pairs, members, coverage, office rotation, discounts,
 * network providers, org-chart details). HIVE had no screen for any of it
 * (HIVE §5: "the only ways to change them are the seed, direct DB edits and the
 * provider import"); HR Centre adds the screens (docs/blueprints/hive.md US-H9).
 *
 * Coverage labels and aliases are matched by EXACT folded equality, so the
 * bounds here are about keeping them usable, not about fuzzy matching.
 *
 * @public
 */

const text = (max: number) =>
  z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);
const id = z.string().trim().min(1).max(64);
const optionalId = z
  .string()
  .trim()
  .max(64)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null);
const order = z.coerce.number().int().min(0).max(9999).default(0);

/** Aliases: trimmed, blank dropped, de-duplicated, at most 40 of 80 characters. */
export const aliasesSchema = z
  .array(z.string().trim().max(80, "An alias is at most 80 characters"))
  .max(40, "At most 40 aliases")
  .transform((list) => [...new Set(list.filter(Boolean))])
  .default([]);

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    "Not a real date",
  );

export const pairSchema = z.object({
  name: text(120),
  order,
  isDefault: z.boolean().default(false),
});

export const memberSchema = z.object({
  pairId: id,
  name: text(120),
  email: z.string().trim().toLowerCase().email("Not an email address").max(200),
  phone: optionalText(40),
  order,
});

export const coverageSchema = z
  .object({
    pairId: id,
    label: text(120),
    aliases: aliasesSchema,
    entityId: optionalId,
    companyWide: z.boolean().default(false),
    directorateId: optionalId,
    departmentId: optionalId,
  })
  .refine((v) => !v.companyWide || v.entityId !== null, {
    message: "Choose the company this row covers as a whole",
    path: ["entityId"],
  });

export const rotationGroupSchema = z.object({
  name: text(120),
  mode: z.enum(["CONSTANT", "GROUP_1", "GROUP_2"]),
  order,
});

export const rotationCoverageSchema = z.object({
  groupId: id,
  label: text(120),
  aliases: aliasesSchema,
  entityId: optionalId,
  directorateId: optionalId,
  departmentId: optionalId,
});

export const discountSchema = z.object({
  name: text(120),
  offerSummary: text(1000),
  eligibility: z.enum(["ALL", "FEMALE_ONLY", "FEMALE_PLUS_FAMILY"]).default("ALL"),
  // Null = "not specified", which is NOT expired (HIVE AC-4.2).
  validUntil: isoDay
    .transform((d) => new Date(`${d}T00:00:00.000Z`))
    .nullable()
    .default(null)
    .or(z.literal("").transform(() => null)),
  redemption: optionalText(1000),
  onlineOnly: z.boolean().default(false),
  url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "Use an http(s) address")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  order,
});

export const providerSchema = z.object({
  name: text(200),
  providerType: optionalText(120),
  location: text(120),
  address: optionalText(500),
  phone: optionalText(60),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The rotation anchor and weekend (HIVE §4.4). The anchor must be a SUNDAY:
 * weeks start on Sunday, and an anchor mid-week would shift every answer.
 */
export const rotationConfigSchema = z.object({
  anchorDate: isoDay.refine(
    (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0,
    "The anchor must be a Sunday (weeks start on Sunday)",
  ),
  anchorType: z.enum(["A", "B"]),
  timezone: z.string().trim().min(1).max(64).refine(isTimeZone, "Not a known time zone"),
  weekendDays: z
    .array(z.coerce.number().int().min(1).max(7))
    .max(3, "At most three weekend days")
    .transform((d) => [...new Set(d)].sort()),
});

export const orgInfoSchema = z.object({
  kind: z.enum(["COMPANY", "DIRECTORATE", "DEPARTMENT", "TEAM"]),
  unitId: id,
  leaderName: optionalText(120),
  leaderTitle: optionalText(120),
  order,
});

export const referenceQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const REFERENCE_SCHEMAS = {
  pairs: pairSchema,
  members: memberSchema,
  coverage: coverageSchema,
  "rotation-groups": rotationGroupSchema,
  "rotation-coverage": rotationCoverageSchema,
  discounts: discountSchema,
  providers: providerSchema,
} as const;

export type ReferenceResource = keyof typeof REFERENCE_SCHEMAS;

export function isReferenceResource(value: string): value is ReferenceResource {
  return Object.hasOwn(REFERENCE_SCHEMAS, value);
}
