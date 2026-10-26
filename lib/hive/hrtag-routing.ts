/**
 * §6.6's HR Tag routing, as pure functions over rows.
 *
 * Split out of `tools/hrtags.ts` for the same reason `rotation.ts` is split out
 * of `tools/rotation.ts`: the routing rules are the part worth reading and
 * worth testing, and they touch neither Prisma nor `server-only`. What is left
 * in the tool file is the two queries and the registration.
 *
 * The ORDER these are applied in is the correctness — see {@link matchCompanyWide}.
 *
 * @public
 */

import { fold } from "./civil";

interface MemberRow {
  name: string;
  email: string;
  phone: string | null;
  photoKey: string | null;
}

export interface CoverageRow {
  label: string;
  aliases: string[];
  /** Company-wide routing: the company this row covers wholesale (HIVE `companyId`). */
  companyId: string | null;
  /** HR Centre: the company this row belongs to (scoping), set on directorate rows too. */
  entityId?: string | null;
  /** Optional soft link to a core unit (directorate / department). */
  orgUnitId: string | null;
}

/**
 * Is this coverage row a candidate for `company`'s employee? No company named →
 * every row; else a row that covers the company wholesale, is scoped to it, or
 * is linked to one of its units.
 */
export function inCompanyOf(company: CompanyRow | null) {
  const unitIds = new Set(company?.units.map((u) => u.id) ?? []);
  return (c: CoverageRow) =>
    !company ||
    c.companyId === company.id ||
    (c.entityId ?? null) === company.id ||
    (c.orgUnitId !== null && unitIds.has(c.orgUnitId));
}

export interface PairRow {
  id: string;
  name: string;
  isDefault: boolean;
  members: MemberRow[];
  coverage: CoverageRow[];
}

export interface CompanyRow {
  id: string;
  name: string;
  units: { id: string }[];
}

/** A tool result, structurally. Kept local so this module imports no server code. */
type Result = Record<string, unknown>;

/**
 * §6.6's card. Contact details only.
 *
 * `photoKey` becomes `hasPhoto` rather than travelling as a key: the model has
 * no use for a blob key, and a key in the model's context is a key that can end
 * up in an answer.
 */
export function pairCard(pair: PairRow) {
  return {
    pair: pair.name,
    members: pair.members.map((m) => ({
      name: m.name,
      email: m.email,
      phone: m.phone,
      hasPhoto: m.photoKey !== null,
    })),
  };
}

/** Does this coverage row match what the employee said? */
function coverageMatches(row: CoverageRow, said: string): boolean {
  if (!said) return false;
  // Equality on folded strings, never substring. "Data" must not silently
  // resolve to "Data Engineering & Analytics" when "Data Management" is also a
  // real alias — routing an employee to the wrong pair sends their question to
  // two people who do not handle it.
  return fold(row.label) === said || row.aliases.some((a) => fold(a) === said);
}

/**
 * Which company are we answering for?
 *
 * A named company resolves BY NAME or not at all. Falling through to §3.5's
 * selector when the name does not match is the bug that hides the typo: an
 * employee asking about "Codelien" with Rihal selected would be handed Rihal's
 * answer, confidently, and the `company_unknown` branch would be unreachable
 * for anyone who had used the selector.
 */
export function resolveCompany(
  companies: CompanyRow[],
  saidCompany: string,
  ctxCompanyId: string | null,
): { company: CompanyRow | null; unknown: boolean } {
  if (saidCompany) {
    const named = companies.find((c) => fold(c.name) === fold(saidCompany)) ?? null;
    return { company: named, unknown: named === null };
  }
  const selected = ctxCompanyId ? (companies.find((c) => c.id === ctxCompanyId) ?? null) : null;
  return { company: selected, unknown: false };
}

/**
 * §6.6: "Codeline routes directly to Shahed & Afra; TP routes directly to Siham
 * & Alaa." Both are `companyId` coverage rows, so this is one lookup rather
 * than two special cases — and a company added later routes correctly the
 * moment Alaa gives it a coverage row.
 *
 * **This runs before any directorate match**, and the two defences are
 * different:
 *
 * - What stops a TP employee saying "Operations" from reaching Shahed & Afra is
 *   {@link matchDirectorate}'s company SCOPING — that Rihal row is linked to a
 *   Rihal org unit, so it is not a candidate for a TP employee at all. (An
 *   earlier version of this comment credited the ordering for that. It does not:
 *   with scoping in place, reordering these two steps leaves that case correct.)
 * - What the ORDER decides is the genuinely overlapping case: a coverage row
 *   linked to one of *this* company's own units, on a different pair from the
 *   company-wide row. §6.6 says "TP routes directly to Siham & Alaa", so the
 *   wholesale rule wins and the directorate they name cannot change the answer.
 *
 * Both are load-bearing and both are pinned by tests; neither makes the other
 * redundant.
 */
export function matchCompanyWide(routable: PairRow[], company: CompanyRow | null): Result | null {
  if (!company) return null;
  const pair = routable.find((p) => p.coverage.some((c) => c.companyId === company.id));
  return pair ? { status: "ok", matchedOn: "company", ...pairCard(pair) } : null;
}

/**
 * What the employee SAID about their directorate. §6.6's flow asks the company
 * first, but someone who leads with "I'm in Tech" should not be asked it again.
 *
 * Scoped by `inCompany`: "Commercials" is a directorate in both Rihal and
 * Transformation Pioneers, and matching across companies would report an
 * ambiguity the selector had already resolved.
 */
export function matchDirectorate(
  routable: PairRow[],
  askedUnit: string,
  saidUnit: string,
  inCompany: (c: CoverageRow) => boolean,
): Result | null {
  if (!askedUnit) return null;
  const hit = (c: CoverageRow) => inCompany(c) && coverageMatches(c, askedUnit);
  const byUnit = routable.filter((p) => p.coverage.some(hit));
  if (byUnit.length === 1)
    return { status: "ok", matchedOn: "directorate", ...pairCard(byUnit[0]) };
  if (byUnit.length === 0) return null;
  // Coverage is admin-editable (§4.2), so the same alias landing on two pairs is
  // a configuration Alaa can create. Picking whichever sorts first would route
  // an employee's question to two people who do not handle it, and would do it
  // silently — so the tool asks instead.
  return {
    status: "ambiguous_directorate",
    asked: saidUnit,
    options: byUnit.flatMap((p) => p.coverage.filter(hit).map((c) => c.label)),
    detail: `"${saidUnit}" is covered by more than one HR Tag pair. Ask which of these they are in — do not pick one.`,
  };
}

/**
 * §3.5's selector, if they picked a directorate and said nothing.
 *
 * The same link the rotation tool uses. Leaving it unread meant an employee who
 * had ALREADY told us their directorate was asked for it again.
 */
export function matchSelector(routable: PairRow[], orgUnitId: string | null): Result | null {
  if (!orgUnitId) return null;
  const bySelector = routable.filter((p) => p.coverage.some((c) => c.orgUnitId === orgUnitId));
  return bySelector.length === 1
    ? { status: "ok", matchedOn: "selector", ...pairCard(bySelector[0]) }
    : null;
}

/** Which pair, and how we got there. `pair` is null when nothing resolved. */
export interface PairResolution {
  pair: PairRow | null;
  matchedOn: "company" | "directorate" | "selector" | null;
  /** Set when a directorate matched MORE THAN ONE pair (§4.2 lets Alaa do that). */
  ambiguous: Result | null;
}

/**
 * §6.6's routing, once, for every caller.
 *
 * Returns the `PairRow` rather than a card. The escalation service needs the
 * pair's **id** to file a row against, and recovering that from the display name
 * — as it did first — files against the wrong pair the day two pairs share a
 * name, which nothing in the schema prevents (`HrTagPair.name` is not unique).
 *
 * An ambiguity is reported ALONGSIDE a null pair rather than instead of one, so
 * a caller can decide what it means. It stopped the `??` chain when it was just
 * another non-null result, which silently discarded a §3.5 selector that
 * resolved perfectly well.
 */
export function resolvePair(
  routable: PairRow[],
  company: CompanyRow | null,
  askedUnit: string,
  saidUnit: string,
  inCompany: (c: CoverageRow) => boolean,
  orgUnitId: string | null,
): PairResolution {
  const byCompany = matchCompanyWide(routable, company);
  if (byCompany) {
    const pair = routable.find((p) => p.coverage.some((c) => c.companyId === company?.id)) ?? null;
    return { pair, matchedOn: "company", ambiguous: null };
  }

  let ambiguous: Result | null = null;
  if (askedUnit) {
    const hit = (c: CoverageRow) => inCompany(c) && coverageMatches(c, askedUnit);
    const byUnit = routable.filter((p) => p.coverage.some(hit));
    if (byUnit.length === 1) return { pair: byUnit[0], matchedOn: "directorate", ambiguous: null };
    if (byUnit.length > 1) ambiguous = matchDirectorate(routable, askedUnit, saidUnit, inCompany);
  }

  if (orgUnitId) {
    const bySelector = routable.filter((p) => p.coverage.some((c) => c.orgUnitId === orgUnitId));
    if (bySelector.length === 1) {
      return { pair: bySelector[0], matchedOn: "selector", ambiguous };
    }
  }

  return { pair: null, matchedOn: null, ambiguous };
}
