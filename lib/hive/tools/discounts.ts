import { prisma } from "@/lib/prisma";
import { registerTool, type ToolContext, type ToolResult } from "./index";
import { expiryStateFor, fold, muscatDate, type CivilDate } from "../civil";

/**
 * §6.4's employee discounts, with §4.5's expiry check.
 *
 * §4.5 is the whole reason this is a tool rather than prompt content:
 *
 *   "The bot must compare today's real date against that expiry automatically
 *    and clearly flag an offer as expired (suggesting the employee confirm with
 *    HR whether it's been renewed) rather than silently continuing to show
 *    outdated information."
 *
 * A partner list in the prompt would be a snapshot the model reads out; every
 * offer would stay live forever, and the failure would be invisible — the answer
 * reads perfectly right up to the day it starts being wrong. Comparing dates
 * here means an expired offer is *labelled* expired in the tool result, so the
 * model cannot present it as current without contradicting what it was handed.
 *
 * `muscatDate`, `fold` and `expiryStateFor` come from `lib/hive/civil.ts` — the
 * pure module that owns "what day is it in Muscat" and case/punctuation folding.
 * The first two lived in `rotation.ts` until this file needed them, which is
 * when it became clear neither was a rotation concept.
 *
 * @public
 */

/**
 * §6.4's eligibility, as stored. The model is told what a restriction MEANS
 * rather than being handed an enum: §6.4's closing note asks for a specific
 * behaviour — "if a male employee asks about a female-only offer, politely
 * redirect and offer to show other discounts rather than dwelling on the
 * restriction" — and that needs a sentence, not a token.
 *
 * HIVE never knows who is asking (§5.1 — the surface is anonymous, and §2.2
 * forbids it confirming personal data), so it cannot and must not filter by the
 * employee. It states the restriction and lets the person judge.
 */
export const ELIGIBILITY_NOTE: Record<string, string> = {
  ALL: "Open to all employees.",
  FEMALE_ONLY:
    "For female employees. State the restriction plainly and let the person judge whether it applies to them — never ask who they are or whether they qualify. If they say it does not apply, say so warmly in one line and offer the other discounts instead — do not dwell on it.",
  FEMALE_PLUS_FAMILY:
    "For female staff and first-degree female family members (interns and trainees included, without family). State the restriction plainly and let the person judge whether it applies to them — never ask who they are or whether they qualify. If they say it does not apply, offer the other discounts.",
};

/**
 * What to say about an eligibility value this file has no wording for.
 *
 * Falling back to `ALL` would have been the natural-looking default and is the
 * one thing that must not happen: a fourth enum value added by a future
 * migration would silently become "Open to all employees", inventing an
 * entitlement, and nothing would go red until an employee was turned away at a
 * counter. Saying "I don't know, ask HR" is the honest failure.
 *
 * `tests/contracts/hive-tools.test.ts` reads the enum out of
 * `prisma/schema.prisma` and fails if a value is unmapped, so this fallback is
 * the safety net rather than the plan.
 */
const ELIGIBILITY_UNKNOWN =
  "The recorded eligibility for this offer is not one HIVE has wording for. Do not say who it is open to — say you are not sure and offer to check with their HR Tag; call `hr_tag` to name that specific pair rather than saying 'ask HR'.";

interface PartnerRow {
  name: string;
  offerSummary: string;
  eligibility: string;
  validUntil: Date | null;
  redemption: string | null;
  onlineOnly: boolean;
  url: string | null;
}

function describe(row: PartnerRow, today: CivilDate) {
  const state = expiryStateFor(row.validUntil, today);
  const until = row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null;
  return {
    partner: row.name,
    offer: row.offerSummary,
    eligibility: ELIGIBILITY_NOTE[row.eligibility] ?? ELIGIBILITY_UNKNOWN,
    validUntil: until,
    status: state,
    howToRedeem:
      row.redemption ??
      (row.onlineOnly
        ? "Online only — register with your work email and the discount is applied at checkout."
        : "Show your company ID card at the time of service."),
    url: row.url,
    note:
      state === "expired"
        ? `This offer's listed validity ended on ${until}. Say so plainly and offer to check with their HR Tag whether it has been renewed — call the hr_tag tool to name that pair. Do not present it as current.`
        : state === "unspecified"
          ? "No end date is listed for this one, so do not claim it is still running — suggest confirming with HR if it matters."
          : undefined,
  };
}

interface DiscountArgs {
  /** A partner name, if the employee named one. Omit to list everything. */
  partner?: unknown;
}

/** How many partners one call returns. §6.4 lists ten; the cap is headroom. */
const PAGE = 100;

/**
 * §6.4's general rules, with the exception list **derived from the rows**.
 *
 * The first cut hardcoded "except Silaf which is online only" because that is
 * what §6.4's prose says today. Adding a second online-only partner would then
 * have produced a general rule that contradicts that partner's own
 * `howToRedeem` — HIVE telling an employee to show an ID card at a shop that
 * has no counter. That is exactly the stale-snapshot failure this tool exists
 * to prevent, reintroduced one line below the comment saying so.
 */
function generalRules(rows: PartnerRow[]): string {
  // `onlineOnly` alone, NOT `onlineOnly && !redemption`. The seed gives every
  // partner explicit redemption text, so excluding rows that carry their own
  // steps emptied this list against real data while passing against a fixture
  // where redemption was null — the general rule went back to a flat "show your
  // ID card" while Silaf's own card said online only.
  const online = rows.filter((r) => r.onlineOnly).map((r) => r.name);
  const except =
    online.length === 0
      ? ""
      : ` except ${new Intl.ListFormat("en", { type: "conjunction" }).format(online)}, which ${online.length === 1 ? "is" : "are"} online only`;
  return (
    `Show the company ID card at the time of service to redeem${except}. ` +
    `Where a partner lists its own redemption steps, those win. ` +
    `All discounts are for personal use only. Anything beyond what is listed goes to the employee's HR Tag — call \`hr_tag\` and name that specific pair, never a generic "ask HR" and never an address from memory.`
  );
}

export async function runDiscounts(rawArgs: unknown, _ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as DiscountArgs;
  const today = muscatDate();

  const rows = await prisma.discountPartner.findMany({
    where: { deletedAt: null },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      name: true,
      offerSummary: true,
      eligibility: true,
      validUntil: true,
      redemption: true,
      onlineOnly: true,
      url: true,
    },
    // One more than the cap, so truncation is DETECTED rather than assumed
    // away. Both branches below tell the model the list is complete — the
    // `partner_unknown` one says "do not guess at a near match" — and a silent
    // cut would turn a real partner at row 101 into a confident denial.
    take: PAGE + 1,
  });

  if (rows.length === 0) {
    return { error: "no_discounts", detail: "No discount partners are set up yet." };
  }

  const truncated = rows.length > PAGE;
  const visible: PartnerRow[] = rows
    .slice(0, PAGE)
    .map((r) => ({ ...r, eligibility: String(r.eligibility) }));
  const partners = visible.map((r) => describe(r, today));

  const asked = typeof args.partner === "string" ? fold(args.partner) : "";
  if (asked) {
    const one = partners.find((p) => fold(p.partner) === asked);
    if (one) return { today, ...one };
    // Not found is a LIST, not an apology: §6.4's general rules say questions
    // beyond what is listed go to the employee's HR Tag (§6.4 as amended,
    // A-1), and the model needs the real partner names to say what IS available
    // rather than inventing a near-match.
    return {
      today,
      status: "partner_unknown",
      asked: args.partner,
      partners,
      truncated,
      detail: truncated
        ? `No partner by that name in the first ${PAGE} offers, but there are more than ${PAGE} — say you could not find it rather than that it does not exist, and offer to ask their HR Tag; call \`hr_tag\` to name that pair.`
        : `No partner by that name. These are the current offers — do not guess at a near match.`,
    };
  }

  return {
    today,
    status: "ok",
    partners,
    truncated,
    generalRules: generalRules(visible),
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "employee_discounts",
      description:
        "Rihal's employee discount partners, their offers, who is eligible, and whether each is " +
        "still valid today. Call this for ANY discount or benefit question — never list partners " +
        "or state an expiry from memory, because the validity is checked against today's date " +
        "here and an offer may have lapsed since.",
      parameters: {
        type: "object",
        properties: {
          partner: {
            type: "string",
            description:
              "A partner name, if the employee named one (for example 'Minimo Cafe'). Omit to " +
              "get every partner.",
          },
        },
      },
    },
  },
  run: runDiscounts,
});
