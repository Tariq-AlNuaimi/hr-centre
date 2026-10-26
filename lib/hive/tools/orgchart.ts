import { prisma } from "@/lib/prisma";
import { registerTool, type ToolContext, type ToolResult } from "./index";
import { fold } from "../civil";
import { loadCompanies } from "../hrtag-source";

/**
 * §6.5's organization structure, as a drill-down the model can walk.
 *
 * §6.5 asks for a specific SHAPE, not just the facts:
 *
 *   "Top-level flow: 'Which company?' → Rihal / Transformation Pioneers /
 *    Codeline… Present each level as tappable options (see 3.5), never one long
 *    text dump."
 *
 * So this tool answers one level at a time and always returns the next level's
 * `options`. Handing the model the whole tree would produce the long text dump
 * §6.5 forbids — and it would do it while looking like a complete answer, which
 * is why the constraint lives here rather than in prompt wording.
 *
 * **This tool owns the TREE. It does not own flat rosters.** §6.5 also lists
 * each company's executives (Rihal's CEO/COO/CTO, TP's CEO/COO), and those are
 * not a level of the chart — no one drills into a CEO. They are neither
 * `Company` nor `OrgUnit` fields in the schema, and inventing a level for them
 * would put three fake units at the top of every drill-down. They live in the
 * `org-structure` topic's admin-editable answers instead, which §4.2 already
 * requires to be editable with no deploy. If a future migration adds real
 * leadership columns, this is the file that should start returning them.
 *
 * §4.4's binding note applies here as hard as anywhere: rotation groups, HR Tag
 * coverage and the org chart are three independent structures that only happen
 * to overlap. This file reads the core org (OrgEntity → Directorate →
 * Department → Team) plus `hive_org_unit_info` (leaders, order) and nothing else — it
 * never consults `RotationCoverage` or `HrTagCoverage` to resolve a name, and it
 * must not start, because that is the collapse the note forbids.
 *
 * @public
 */

interface UnitRow {
  id: string;
  name: string;
  kind: string;
  leaderName: string | null;
  leaderTitle: string | null;
  parentId: string | null;
}

/**
 * What §6.5 says about a company with no chart yet.
 *
 * Derived from the data — a company with no units — not from the name
 * "Codeline". §4.2's whole premise is that Alaa restructures without a
 * developer, so a fourth company added tomorrow gets this same honest answer,
 * and Codeline stops getting it the day its chart is entered.
 */
function noChartYet(companyName: string) {
  return {
    status: "no_chart",
    company: companyName,
    detail:
      `There is no org chart on file for ${companyName} yet. Say that plainly — do not guess at ` +
      `a structure or reuse another company's — and offer to show them their HR Tag instead.`,
  };
}

/** "Rihal's", but "Transformation Pioneers'". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/**
 * What to call this level: "directorates" for Rihal, "departments" for TP.
 *
 * Falls back to "units" when the level mixes kinds rather than naming them all
 * after whichever happened to sort first — Alaa can restructure freely (§4.2),
 * so a mixed top level is a configuration this must survive, not a bug.
 */
function levelNoun(level: UnitRow[]): string {
  const kinds = new Set(level.map((u) => u.kind));
  return kinds.size === 1 ? `${[...kinds][0].toLowerCase()}s` : "units";
}

function card(unit: UnitRow, children: UnitRow[]) {
  return {
    unit: unit.name,
    kind: unit.kind.toLowerCase(),
    leader: unit.leaderName,
    leaderTitle: unit.leaderTitle,
    // §6.5's closing note on TP: "Employee-facing answers should state
    // department name + manager only — do not expose the structural/
    // reporting-line distinction above." Nothing here carries a reporting line:
    // the four peer departments are top-level rows exactly like Commercials and
    // Operations, so presenting them as peers requires no special case, and
    // there is no field for the model to leak even if it wanted to.
    teams: children.map((c) => c.name),
  };
}

/**
 * One company's chart from the CORE org, in HIVE's unit shape. HIVE's kinds:
 * a directorate is DIRECTORATE; a department directly under the company is
 * DEPARTMENT (TP); a department under a directorate is what HIVE called a TEAM
 * (Rihal's "Human Resources" under Operations), as is a core Team. Leaders and
 * order come from `hive_org_unit_info`; without a row, name order and no leader.
 */
async function loadUnits(entityId: string): Promise<UnitRow[]> {
  const [directorates, departments] = await Promise.all([
    prisma.directorate.findMany({
      where: { entityId, deletedAt: null },
      select: { id: true, name: true },
      take: 200,
    }),
    prisma.department.findMany({
      where: { entityId, deletedAt: null },
      select: {
        id: true,
        name: true,
        directorateId: true,
        teams: { where: { deletedAt: null }, select: { id: true, name: true }, take: 100 },
      },
      take: 300,
    }),
  ]);
  const liveDirectorates = new Set(directorates.map((d) => d.id));
  const raw: Omit<UnitRow, "leaderName" | "leaderTitle">[] = [
    ...directorates.map((d) => ({ id: d.id, name: d.name, kind: "DIRECTORATE", parentId: null })),
    ...departments.map((d) => {
      const parentId =
        d.directorateId && liveDirectorates.has(d.directorateId) ? d.directorateId : null;
      return { id: d.id, name: d.name, kind: parentId ? "TEAM" : "DEPARTMENT", parentId };
    }),
    ...departments.flatMap((d) =>
      d.teams.map((t) => ({ id: t.id, name: t.name, kind: "TEAM", parentId: d.id })),
    ),
  ];
  const info = await prisma.hiveOrgUnitInfo.findMany({
    where: { unitId: { in: raw.map((u) => u.id) } },
    select: { unitId: true, leaderName: true, leaderTitle: true, order: true },
    take: 600,
  });
  const byId = new Map(info.map((i) => [i.unitId, i]));
  return raw
    .map((u) => ({
      ...u,
      leaderName: byId.get(u.id)?.leaderName ?? null,
      leaderTitle: byId.get(u.id)?.leaderTitle ?? null,
      order: byId.get(u.id)?.order ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ order: _order, ...u }) => u);
}

interface OrgArgs {
  /** A company name, if the employee named or picked one. */
  company?: unknown;
  /** A directorate, department or team name to drill into. */
  unit?: unknown;
}

export async function runOrgChart(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as OrgArgs;
  const saidCompany = typeof args.company === "string" ? args.company : "";
  const saidUnit = typeof args.unit === "string" ? args.unit : "";

  const companies = await loadCompanies();
  if (companies.length === 0) {
    return { error: "no_companies", detail: "No companies are set up yet." };
  }

  // Prefer what they SAID over §3.5's selector: an employee in Rihal may well
  // ask what TP's structure looks like, and answering about their own company
  // instead would be confidently wrong.
  //
  // And a named company resolves BY NAME or not at all — never falling through
  // to the selector. That fallback turns a typo into a confident answer about
  // the wrong company ("Codelien" with Rihal selected returns Rihal's chart)
  // and makes the message below unreachable for anyone who used the selector.
  const company = saidCompany
    ? (companies.find((c) => fold(c.name) === fold(saidCompany)) ?? null)
    : ctx.companyId
      ? (companies.find((c) => c.id === ctx.companyId) ?? null)
      : null;

  if (!company) {
    return {
      status: "which_company",
      options: companies.map((c) => c.name),
      detail: saidCompany
        ? `"${saidCompany}" is not one of the companies. Ask which one they mean, offering these.`
        : "§6.5 starts by asking which company. Offer these as tappable options.",
    };
  }

  const units = await loadUnits(company.id);

  const childrenOf = (id: string | null) => units.filter((u) => u.parentId === id);
  const top = childrenOf(null);

  // No TOP level, not merely no rows. Soft-delete does not cascade, so deleting
  // a directorate leaves its teams behind with a `parentId` pointing at a row
  // this query no longer returns — `units.length === 0` would then be false and
  // the tool would answer `pick_unit` with an empty options list while the
  // orphans stayed unreachable at every level.
  if (top.length === 0) return noChartYet(company.name);

  if (!saidUnit) {
    return {
      status: "pick_unit",
      company: company.name,
      // Only the top level. §6.5's "never one long text dump" is the whole
      // reason this is not the entire tree flattened.
      options: top.map((u) => ({
        unit: u.name,
        leader: u.leaderName,
        leaderTitle: u.leaderTitle,
      })),
      detail: `These are ${possessive(company.name)} ${levelNoun(top)}. Offer them as tappable options and drill in when one is picked.`,
    };
  }

  const asked = fold(saidUnit);
  const matches = units.filter((u) => fold(u.name) === asked);
  if (matches.length > 1) {
    // Two units of the same name in one company — "Support" under Operations
    // and under Technology, say. §4.2 lets Alaa create exactly that, and taking
    // the first would return one unit's leader and teams under the other's name,
    // as a confident `ok`.
    return {
      status: "ambiguous_unit",
      company: company.name,
      asked: saidUnit,
      options: matches.map((u) => ({
        unit: u.name,
        under: u.parentId ? (units.find((x) => x.id === u.parentId)?.name ?? null) : null,
      })),
      detail: `${company.name} has more than one "${saidUnit}". Ask which one they mean — do not pick one.`,
    };
  }
  const match = matches[0];
  if (!match) {
    return {
      status: "unit_unknown",
      company: company.name,
      asked: saidUnit,
      options: top.map((u) => u.name),
      detail: `"${saidUnit}" is not part of ${company.name}'s chart. Ask which one they mean rather than guessing at the closest name.`,
    };
  }

  return {
    status: "ok",
    company: company.name,
    ...card(match, childrenOf(match.id)),
    // The path back up, so the model can say "Software sits under Technology &
    // Development" without walking the tree itself.
    parent: match.parentId ? (units.find((u) => u.id === match.parentId)?.name ?? null) : null,
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "organization_structure",
      description:
        "Rihal's, Transformation Pioneers' and Codeline's org charts — which directorates and " +
        "departments exist, who leads each, and which teams sit under them. Call this for ANY " +
        "question about the org chart, a directorate, a department, a team, or who leads one. " +
        "Answer one level at a time from the options it returns; never dump the whole structure.",
      parameters: {
        type: "object",
        properties: {
          company: {
            type: "string",
            description:
              "The company, if the employee has said or picked one ('Rihal', 'Transformation " +
              "Pioneers', 'Codeline'). Omit to be given the list to ask with.",
          },
          unit: {
            type: "string",
            description:
              "A directorate, department or team to drill into, in the employee's own words " +
              "(for example 'Operations', 'Software'). Omit to get that company's top level.",
          },
        },
      },
    },
  },
  run: runOrgChart,
});
