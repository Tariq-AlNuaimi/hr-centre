import { prisma } from "@/lib/prisma";
import { registerTool, type ToolContext, type ToolResult } from "./index";

/**
 * §4.6's network provider search.
 *
 * §4.6 states the requirement and the reason in the same breath:
 *
 *   "if an employee asks whether a specific clinic is in-network, the bot must
 *    search and display the matching entries (name, type, location) rather than
 *    asserting a flat yes/no. Some providers have multiple branches, and only
 *    some may be in-network at a specific location — a confident wrong 'yes'
 *    could cost the employee money by sending them to the wrong branch expecting
 *    direct billing."
 *
 * So **nothing this tool returns is a boolean.** There is no `covered` field for
 * the model to read out, because the answer to "is Badr Al Samaa covered" is a
 * list of branches, not a yes. That is a structural refusal in the same spirit
 * as §6.7's unloaded penalty content: an instruction not to say "yes" can be
 * argued with by an employee who just wants a straight answer; a result shape
 * with no yes in it cannot.
 *
 * The list is 464 rows and arrives as data (OQ-7 — Alaa uploads it, §4.2), so
 * this file assumes nothing about which providers exist.
 *
 * @public
 */

/**
 * How close a trigram match has to be before it is worth showing.
 *
 * Deliberately low. A miss here is an employee told their clinic is not in the
 * network when it is — under §4.6's own logic that is the expensive direction,
 * because they go somewhere else and pay. A loose match costs a line of extra
 * output and the employee picks; every result is shown WITH its location and
 * address precisely so they can.
 */
const SIMILARITY_FLOOR = 0.25;

/** Rows per answer. The whole list is a document (AC-5.3), never a chat dump. */
const PAGE = 25;

interface ProviderRow {
  name: string;
  providerType: string | null;
  location: string;
  address: string | null;
  phone: string | null;
}

/**
 * Trigram search over `name`.
 *
 * `$queryRaw` with placeholders, because `similarity()` has no Prisma DSL
 * equivalent and the ordering IS the feature — an alphabetical list of fuzzy
 * matches buries the branch the employee meant. Columns are named explicitly;
 * `SELECT *` would pull `deletedAt`/`deletedBy` into the model's context for
 * nothing.
 *
 * **This predicate does NOT use the `gin_trgm_ops` index**, and an earlier
 * version of this comment claimed it did. Only `%` and `<->` are index-usable;
 * `similarity(a, b) > k` is a filter, so each call is a sequential scan. That is
 * a deliberate trade at 464 rows: `%` would bind the threshold to pg_trgm's
 * session-wide default of 0.3, and {@link SIMILARITY_FLOOR} is set lower than
 * that on purpose — under §4.6's own logic a MISS is the expensive direction,
 * because the employee goes elsewhere and pays. The migration trigger is the
 * list growing by an order of magnitude, at which point `%` plus a session
 * `set_limit()` buys the index back.
 */
async function searchByName(
  needle: string,
  limit: number,
  location: string | null,
): Promise<ProviderRow[]> {
  // The location filter goes INTO the query rather than being applied to the
  // page afterwards. Filtering after `LIMIT` means a chain with more branches
  // than one page can have the named branch cut before the filter ever sees it,
  // and the tool then tells the employee there is nothing in their town — the
  // confident wrong answer §4.6 is written to prevent.
  if (location !== null) {
    return prisma.$queryRaw<ProviderRow[]>`
      SELECT "name", "providerType", "location", "address", "phone"
      FROM "hive_network_providers"
      WHERE "deletedAt" IS NULL
        AND similarity("name", ${needle}) > ${SIMILARITY_FLOOR}
        AND "location" ILIKE ${`%${location}%`}
      ORDER BY similarity("name", ${needle}) DESC, "location" ASC
      LIMIT ${limit}
    `;
  }
  return prisma.$queryRaw<ProviderRow[]>`
    SELECT "name", "providerType", "location", "address", "phone"
    FROM "hive_network_providers"
    WHERE "deletedAt" IS NULL
      AND similarity("name", ${needle}) > ${SIMILARITY_FLOOR}
    ORDER BY similarity("name", ${needle}) DESC, "location" ASC
    LIMIT ${limit}
  `;
}

interface ProviderArgs {
  /** The clinic or hospital the employee named. */
  name?: unknown;
  /** A town or area, if they narrowed it. */
  location?: unknown;
}

export async function runProviders(rawArgs: unknown, _ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as ProviderArgs;
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const location = typeof args.location === "string" ? args.location.trim() : "";

  const total = await prisma.networkProvider.count({ where: { deletedAt: null } });
  if (total === 0) {
    return {
      error: "no_providers",
      detail:
        "The network provider list has not been uploaded yet. Say so plainly and offer to put " +
        "them in touch with their HR Tag — do not guess whether a clinic is covered.",
    };
  }

  if (!name && !location) {
    // AC-5.3: the whole list is a file, not 464 lines of chat.
    return {
      status: "need_a_name",
      total,
      detail:
        `There are ${total} providers in the network list. Ask which clinic or hospital they ` +
        `mean — and if they want the whole thing, hand over the downloadable list instead of ` +
        `reading it out.`,
    };
  }

  // A named provider goes through trigram search; a location-only ask is an
  // ordinary filter, since "everything in Sohar" is not a fuzzy question.
  //
  // When both are given this runs the narrowed query FIRST and falls back to the
  // unnarrowed one only if it found nothing — two bounded queries rather than
  // one over-fetch. An employee who says "Badr Al Samaa in Nizwa" and gets
  // nothing should still be shown the real branches, because §4.6's whole point
  // is that they pick the right one.
  const narrowed = name && location ? await searchByName(name, PAGE + 1, location) : [];
  const fellBack = Boolean(name) && Boolean(location) && narrowed.length === 0;

  const found =
    narrowed.length > 0
      ? narrowed
      : name
        ? await searchByName(name, PAGE + 1, null)
        : ((await prisma.networkProvider.findMany({
            where: { deletedAt: null, location: { contains: location, mode: "insensitive" } },
            orderBy: [{ location: "asc" }, { name: "asc" }],
            select: { name: true, providerType: true, location: true, address: true, phone: true },
            take: PAGE + 1,
          })) as ProviderRow[]);

  const matches = found.slice(0, PAGE);
  const truncated = found.length > PAGE;

  if (matches.length === 0) {
    return {
      status: "no_match",
      asked: name || location,
      total,
      detail:
        `Nothing in the network list matches "${name || location}". Say that you could not find ` +
        `it rather than that it is not covered — the two are different, and spelling varies. ` +
        `Offer to check another spelling or to hand over the full list.`,
    };
  }

  return {
    status: "matches",
    asked: name || location,
    // §4.6/AC-5.1: entries, never a verdict. There is deliberately no `covered`
    // field here — see this file's header for why that is structural.
    matches,
    truncated,
    // AC-5.2: when several branches match, the employee picks. Said explicitly
    // because a single match is the case where the model is most tempted to
    // turn a row into a "yes".
    detail:
      matches.length === 1
        ? `One entry matches. Show it with its location and address and ask them to confirm it is the branch they mean — do not answer "yes, it's covered".`
        : `${matches.length} entries match${truncated ? ` (of more than ${PAGE})` : ""}. Show them all with their locations so they can pick the right branch — several branches of the same provider are not interchangeable.`,
    ...(fellBack
      ? {
          note: `Nothing matched in "${location}", so these are the other branches. Say that plainly.`,
        }
      : {}),
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "network_providers",
      description:
        "Rihal's medical insurance network provider list — which clinics and hospitals are in " +
        "network, with their branch locations, addresses and phone numbers. Call this for ANY " +
        "question about whether a clinic or hospital is covered, in-network, or direct-bills. " +
        "Never answer that from memory and never answer a bare yes or no: branches of the same " +
        "provider differ, and sending someone to the wrong one costs them money.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "The clinic or hospital as the employee named it (for example 'Badr Al Samaa'). " +
              "Spelling varies — pass their own words, the search is fuzzy.",
          },
          location: {
            type: "string",
            description:
              "A town or area, if they narrowed it (for example 'Ruwi'). Omit if they have not said.",
          },
        },
      },
    },
  },
  run: runProviders,
});
