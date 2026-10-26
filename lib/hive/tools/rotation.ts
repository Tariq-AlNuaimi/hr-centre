import { prisma } from "@/lib/prisma";
import { registerTool, type ToolContext, type ToolResult } from "./index";
import { fold, muscatDate, type CivilDate } from "../civil";
import {
  matchCoverage,
  ANCHOR,
  presenceFor,
  weekTypeFor,
  type CoverageRow,
  type RotationMode,
} from "../rotation";

/**
 * §4.4's rotation, as a tool the model can call.
 *
 * The maths lives in `lib/hive/rotation.ts` and knows nothing about the
 * database; this file is the half §4.4's closing note is about:
 *
 *   "Group/directorate assignments and the constant/rotating structure itself
 *    must be admin-editable, in case the company restructures which departments
 *    belong to which group."
 *
 * So no directorate name appears in this file. Which team is in Group 1 comes
 * from `RotationCoverage` rows, and so do §4.1's sub-team phrasings — "an
 * employee saying 'I'm in Software Engineering' must correctly map to the
 * Technology & Development directorate / Tech rotation group, the same as
 * someone saying 'Tech' or 'DevOps' or 'QA'". Those aliases are DATA on the
 * coverage row, which is what lets Alaa teach HIVE a new sub-team name without
 * a developer.
 *
 * §4.4's other closing note is the one this file could most easily violate:
 * rotation groups, HR-Tag routing and org-chart directorates "are three
 * independent, separately admin-editable structures that happen to partially
 * overlap... They must never be collapsed into a single lookup table." This tool
 * reads `RotationCoverage` and nothing else — it does not fall back to `OrgUnit`
 * names, because that fallback IS the collapse.
 *
 * @public
 */

async function loadCoverage(): Promise<CoverageRow[]> {
  const rows = await prisma.rotationCoverage.findMany({
    where: { deletedAt: null },
    select: {
      label: true,
      aliases: true,
      entityId: true,
      directorateId: true,
      departmentId: true,
      // Nested reads are not covered by the soft-delete extension's top-level
      // `where` rewrite, so a deleted group's coverage would otherwise still
      // resolve.
      group: { select: { mode: true, deletedAt: true } },
    },
    take: 100,
  });
  return rows
    .filter((r) => r.group && r.group.deletedAt === null)
    .map((r) => ({
      label: r.label,
      aliases: r.aliases,
      mode: r.group.mode as RotationMode,
      orgUnitId: r.directorateId ?? r.departmentId ?? null,
      entityId: r.entityId,
    }));
}

/**
 * Is this company outside the rotation entirely (§4.4's Codeline rule)?
 *
 * Returns the company's name when so, else null. Data-driven: a company is
 * covered if a coverage row carries its name, or is linked to one of its org
 * units. Nothing here knows the word "Codeline" — a fourth company added by Alaa
 * with no coverage gets the same correct answer.
 */
async function companyOutsideRotation(
  coverage: CoverageRow[],
  said: string,
  companyId: string | null,
): Promise<string | null> {
  // HR Centre: companies are core OrgEntity rows.
  const company = await prisma.orgEntity.findFirst({
    where: companyId
      ? { id: companyId, deletedAt: null }
      : { name: { equals: said, mode: "insensitive" }, deletedAt: null },
    select: {
      id: true,
      name: true,
      directorates: { where: { deletedAt: null }, select: { id: true }, take: 200 },
      departments: { where: { deletedAt: null }, select: { id: true }, take: 500 },
    },
  });
  if (!company) return null;

  const coveredByName = coverage.some((c) => fold(c.label) === fold(company.name));
  const unitIds = new Set([...company.directorates, ...company.departments].map((u) => u.id));
  const coveredByUnit = coverage.some(
    (c) => c.entityId === company.id || (c.orgUnitId && unitIds.has(c.orgUnitId)),
  );
  return coveredByName || coveredByUnit ? null : company.name;
}

/**
 * The stored anchor, week type, timezone and weekend (`hive_rotation_config`).
 * HIVE stored this row and never read it (its code used constants); HR Centre
 * reads it so the rotation screen's edits take effect, and falls back to
 * HIVE's constants (2026-03-29 / A / Asia/Muscat / Fri+Sat) when absent.
 *
 * @public
 */
export async function loadRotationConfig(): Promise<{
  anchor: { date: string; type: "A" | "B" };
  timezone: string;
  weekendDays: number[];
}> {
  const row = await prisma.rotationConfig.findUnique({
    where: { id: "singleton" },
    select: { anchorDate: true, anchorType: true, timezone: true, weekendDays: true },
  });
  if (!row) return { anchor: ANCHOR, timezone: "Asia/Muscat", weekendDays: [5, 6] };
  return {
    anchor: { date: row.anchorDate.toISOString().slice(0, 10), type: row.anchorType },
    timezone: row.timezone,
    weekendDays: row.weekendDays,
  };
}

interface RotationArgs {
  /** What the employee called their team, in their own words. */
  team?: unknown;
  /** An ISO date to ask about. Defaults to today in Muscat. */
  date?: unknown;
}

/**
 * The tool body. Exported so it can be exercised directly — the registry holds a
 * reference for the model's use, which is not the same as being callable from a
 * test.
 *
 * @public
 *
 * Every branch returns a result the model can say something true from — never an
 * empty response, which would leave it to compose what the tool would have said
 * (ADR-066's whole reason for using tools here).
 */
export async function runRotation(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as RotationArgs;
  const config = await loadRotationConfig();
  const date: CivilDate =
    typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
      ? args.date
      : muscatDate(new Date(), config.timezone);

  const coverage = await loadCoverage();
  if (coverage.length === 0) {
    return { error: "no_rotation_configured", detail: "No rotation groups are set up yet." };
  }

  // Prefer what they SAID; fall back to the directorate they picked in §3.5's
  // selector, which is an id we can match against `orgUnitId` — that link is on
  // the coverage row itself, so it is still the rotation structure answering,
  // not the org chart.
  const said = typeof args.team === "string" ? args.team : "";
  const matched =
    matchCoverage(coverage, said) ??
    (ctx.orgUnitId ? (coverage.find((c) => c.orgUnitId === ctx.orgUnitId) ?? null) : null);

  const weekType = weekTypeFor(date, config.anchor);

  if (!matched) {
    // §4.4: "Codeline — not part of this rotation at all." That is a DIFFERENT
    // answer from "I don't recognise your team", and the first cut gave both the
    // same one — so a Codeline employee was handed a list of teams they are not
    // on and asked to pick. Derived from the data rather than by name: a company
    // is outside the rotation when nothing covers it, either by its own name or
    // through any of its org units.
    const outside = await companyOutsideRotation(coverage, said, ctx.companyId);
    if (outside) {
      return {
        status: "not_in_rotation",
        company: outside,
        date,
        detail: `${outside} is not part of the office rotation, so it does not apply to them at all. Do not offer them a rotation group.`,
      };
    }

    return {
      status: "team_unknown",
      date,
      weekType,
      // The model needs to ask, and it needs the real vocabulary to offer.
      // These are the admin-editable labels, so the list is whatever Alaa
      // currently has configured.
      knownTeams: coverage.map((c) => c.label),
      detail: said
        ? `"${said}" does not match a rotation group. Ask which of the known teams they are in.`
        : "You do not know this employee's team yet. Ask, offering the known teams.",
    };
  }

  const presence = presenceFor(matched.mode, date, {
    anchor: config.anchor,
    weekendDays: config.weekendDays,
  });

  return {
    status: "ok",
    date,
    weekType,
    team: matched.label,
    /** `CONSTANT` is §4.4's "never rotates" — the model must not describe it as
     *  being on a rotation, because it is not on one. */
    rotates: matched.mode !== "CONSTANT",
    presence: presence.status,
    detail:
      presence.status === "weekend"
        ? `${date} is the weekend (Friday and Saturday), so no rotation applies to anyone.`
        : matched.mode === "CONSTANT"
          ? `${matched.label} is in the office every working day and does not rotate.`
          : `In a Type ${weekType} week, ${matched.label} is ${presence.status} on ${date}.`,
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "office_rotation",
      description:
        "Where a team is working on a given day under the two-week office rotation. Call this " +
        "for ANY question about being in the office, working from home, which week it is, or " +
        "when a team is next in — never work it out yourself, and never guess a week. " +
        "Codeline is not part of the rotation.",
      parameters: {
        type: "object",
        properties: {
          team: {
            type: "string",
            description:
              "The team, directorate or sub-team as the employee described it — pass their own " +
              "words (for example 'DevOps', 'Software Engineering', 'Commercials'). Omit if " +
              "they have not said.",
          },
          date: {
            type: "string",
            description:
              "An ISO date (YYYY-MM-DD) to ask about. Omit for today. Use this for 'next week' " +
              "or a specific day rather than calculating anything yourself.",
          },
        },
      },
    },
  },
  run: runRotation,
});
