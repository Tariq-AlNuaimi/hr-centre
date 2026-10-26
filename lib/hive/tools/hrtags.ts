import { loadCompanies, loadHrPairs } from "../hrtag-source";
import { registerTool, type ToolContext, type ToolResult } from "./index";
import { fold } from "../civil";
import {
  matchCompanyWide,
  matchDirectorate,
  matchSelector,
  inCompanyOf,
  pairCard,
  resolveCompany,
} from "../hrtag-routing";

/**
 * §6.6's HR Tags — an employee's assigned HR pair.
 *
 * "HR Tag" is Rihal's existing internal branding, from a campaign called "Meet
 * your HR Tag!", and §6.6 is explicit that the chatbot must "reuse this exact
 * framing and phrase… for instant recognition". So the tool is named for it and
 * the results say "HR Tag", never "HR contact" or "HR representative".
 *
 * Two things §6.6 asks for that are easy to get backwards:
 *
 * 1. **The card does NOT list what the pair covers.** "Do NOT list which
 *    departments a pair covers on the card itself — that's already implied by
 *    the employee's own department selection." So `coverage` is used to ROUTE
 *    and is never returned on a resolved card. It is returned in one place only:
 *    the disambiguation branch, where the employee has not said enough yet and
 *    the labels are the question being asked.
 * 2. **Never a generic "contact HR".** AC-1.5: "IF no topic matches with
 *    confidence THEN THE SYSTEM SHALL offer escalation naming the employee's
 *    specific HR pair." That is why the unresolved branches still return real
 *    names to ask with, and why {@link runHrTags} never returns an empty result.
 *
 * §4.4's binding note again: HR Tag coverage is its own structure with its own
 * `label` and `aliases`. This file resolves against `HrTagCoverage` and never
 * against `OrgUnit` names or `RotationCoverage` — Operations is covered by
 * Shahed & Afra, is a rotation CONSTANT, and is an org directorate, three facts
 * that are independently editable and must stay that way.
 *
 * **This tool owns ROUTING. It does not own flat rosters.** §6.6 also names an
 * HR Manager (separate from the three pairs, "for senior/escalated matters")
 * who covers nothing and is therefore never routed to. Deriving "this pair is
 * the HR Manager" from "this pair has no coverage rows" would misfire the day a
 * real pair is created before its coverage is entered, so it is not derived at
 * all: the HR Manager lives in the `hr-tags` topic's admin-editable answers.
 *
 * @public
 */

interface HrTagArgs {
  /** The company, if the employee has said or picked one. */
  company?: unknown;
  /** The directorate or department, in the employee's own words. */
  directorate?: unknown;
}

export async function runHrTags(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as HrTagArgs;
  const saidCompany = typeof args.company === "string" ? args.company : "";
  const saidUnit = typeof args.directorate === "string" ? args.directorate : "";

  const [pairs, companies] = await Promise.all([loadHrPairs(), loadCompanies()]);

  const routable = pairs.filter((p) => p.members.length > 0);
  if (routable.length === 0) {
    return { error: "no_hr_tags", detail: "No HR Tag pairs are set up yet." };
  }

  const allCoverage = pairs.flatMap((p) => p.coverage);
  const askedUnit = fold(saidUnit);
  const { company, unknown } = resolveCompany(companies, saidCompany, ctx.companyId);
  if (unknown) {
    return {
      status: "company_unknown",
      asked: saidCompany,
      options: companies.map((c) => c.name),
      detail: `"${saidCompany}" is not one of the companies. Ask which one they mean.`,
    };
  }
  const inCompany = inCompanyOf(company);

  // §6.6's routing, in the order §6.6 states it. Each step returns a card or
  // null; the first that resolves wins, and the ORDER is the correctness — see
  // `matchCompanyWide` for the failure the order prevents.
  const resolved =
    matchCompanyWide(routable, company) ??
    matchDirectorate(routable, askedUnit, saidUnit, inCompany) ??
    matchSelector(routable, ctx.orgUnitId);
  if (resolved) return resolved;

  // 4. The company routes per-directorate (Rihal). §6.6's flow: "ask company →
  //    if Rihal, ask directorate → show the matching pair's card."
  //
  //    Only rows actually LINKED to this company's chart. An unlinked row
  //    (`companyId` and `orgUnitId` both null) belongs to no company we can
  //    name, and offering those meant a newly added company's employee was
  //    shown "Operations Directorate (Rihal)" and routed to a Rihal pair.
  if (company) {
    const labels = allCoverage.filter((c) => inCompany(c)).map((c) => c.label);
    if (labels.length > 0) {
      return {
        status: "which_directorate",
        company: company.name,
        options: [...new Set(labels)],
        detail: `Ask which of these ${company.name} directorates they are in, then show that pair's card. Do not name a pair yet.`,
      };
    }
    // Known company, no coverage of any kind. Say so — do not offer another
    // company's directorates, and do not fall through to the default pair as
    // though this were an ordinary miss.
    return {
      status: "no_coverage",
      company: company.name,
      detail: `No HR Tag pair is assigned to ${company.name} yet. Say that plainly rather than naming a pair, and suggest they ask HR directly.`,
    };
  }

  if (askedUnit) {
    return {
      status: "directorate_unknown",
      asked: saidUnit,
      // Every configured directorate label, INCLUDING those whose pair is
      // currently unstaffed. Hiding an unstaffed pair's directorate tells an
      // employee their own directorate does not exist and pushes them to pick
      // one they are not in.
      options: [...new Set(allCoverage.filter((c) => !c.companyId).map((c) => c.label))],
      detail: `"${saidUnit}" does not match an HR Tag directorate. Ask which one they are in — do not guess at the closest.`,
    };
  }

  // 3. Nothing said yet. §6.6 starts at the company.
  if (companies.length > 0) {
    return {
      status: "which_company",
      options: companies.map((c) => c.name),
      detail:
        "§6.6's flow starts with the company. Ask which one they are in, offering these as " +
        "tappable options.",
    };
  }

  // 4. Last resort. AC-1.5 forbids a generic "contact HR", so even here the
  //    answer is a named pair — the one HR marked as the default — rather than
  //    nothing.
  const fallback = routable.find((p) => p.isDefault) ?? routable[0];
  return {
    status: "default_pair",
    ...pairCard(fallback),
    detail:
      "This is the default HR Tag pair. Name them — never say 'contact HR' — and offer to find " +
      "the right pair if they tell you their directorate.",
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "hr_tag",
      description:
        "An employee's HR Tag — the specific HR pair assigned to their directorate, with names, " +
        "emails and phone numbers. Call this for ANY question about who their HR contact is, and " +
        "ALWAYS before offering to escalate or suggesting they contact HR: the answer must name " +
        "a specific pair, never a generic 'contact HR'. Never state an HR contact from memory.",
      parameters: {
        type: "object",
        properties: {
          company: {
            type: "string",
            description:
              "The company, if the employee has said or picked one ('Rihal', 'Transformation " +
              "Pioneers', 'Codeline'). Omit to be given the list to ask with.",
          },
          directorate: {
            type: "string",
            description:
              "Their directorate or department in their own words (for example 'Tech', " +
              "'Operations', 'Sales'). Omit if they have not said.",
          },
        },
      },
    },
  },
  run: runHrTags,
});
