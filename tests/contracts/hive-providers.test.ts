import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseProviderSheet, mapHeaders, cell } from "../../lib/hive/provider-import";

// §4.6's provider search (US5, AC-5.1, AC-5.2, AC-5.3).
//
// The requirement and its reason are in the same sentence of the spec: "a
// confident wrong 'yes' could cost the employee money by sending them to the
// wrong branch expecting direct billing." So the property worth pinning is not
// that the search works — it is that NO RESULT IS A VERDICT. There is no
// `covered` field for the model to read out, and the tests below assert its
// absence directly, because an instruction not to say "yes" can be argued with
// by someone who just wants a straight answer and a result shape cannot.
//
// The trigram query goes through `$queryRaw`, so the mock captures what was
// interpolated. That is worth an assertion of its own: the difference between a
// tagged template and a built string is the difference between a placeholder
// and an injection, and both read identically at a glance.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Providers = typeof import("../../lib/hive/tools/providers.ts");
let providers: Providers;

const CTX = {
  companyId: null,
  orgUnitId: null,
  sessionId: null,
  source: "SIRAAJ" as const,
  identityVerified: false,
};

const ROWS = [
  {
    name: "Badr Al Samaa Hospital",
    providerType: "Hospital",
    location: "Ruwi",
    address: "Ruwi High Street",
    phone: "+968 1",
  },
  {
    name: "Badr Al Samaa Hospital",
    providerType: "Hospital",
    location: "Al Khuwair",
    address: "Way 3510",
    phone: "+968 2",
  },
  {
    name: "Badr Al Samaa Hospital",
    providerType: "Hospital",
    location: "Sohar",
    address: "Falaj Al Qabail",
    phone: "+968 3",
  },
  {
    name: "Muscat Private Hospital",
    providerType: "Hospital",
    location: "Bausher",
    address: "Bausher Street",
    phone: "+968 4",
  },
];

let rows: typeof ROWS = ROWS;
/** What the last `$queryRaw` actually interpolated, so placeholders are checkable. */
let lastRaw: { strings: readonly string[]; values: unknown[] } | null = null;

/** A crude stand-in for pg_trgm's `similarity()`: shared-word overlap. */
function similar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const [x, y] = [words(a), words(b)];
  const shared = [...y].filter((w) => x.has(w)).length;
  return y.size > 0 && shared / y.size >= 0.5;
}

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        $queryRaw: (strings: readonly string[], ...values: unknown[]) => {
          lastRaw = { strings, values };
          const needle = String(values[0]);
          const limit = Number(values[values.length - 1]);
          // The location filter lives in the SQL now (filtering after `LIMIT`
          // could cut the named branch before the filter saw it), so the mock
          // has to honour it — otherwise it stops modelling the query it stands
          // in for, and the test passes on behaviour the database would not.
          const ilike = strings.join("").includes("ILIKE")
            ? String(values[2]).replaceAll("%", "").toLowerCase()
            : null;
          return Promise.resolve(
            rows
              .filter((r) => similar(r.name, needle))
              .filter((r) => ilike === null || r.location.toLowerCase().includes(ilike))
              .slice(0, limit),
          );
        },
        networkProvider: {
          count: async () => rows.length,
          findMany: async ({
            where,
            take,
          }: {
            where: { location: { contains: string } };
            take: number;
          }) =>
            rows
              .filter((r) =>
                r.location.toLowerCase().includes(where.location.contains.toLowerCase()),
              )
              .slice(0, take),
        },
      },
    },
  });
  providers = (await import(import.meta.resolve("../../lib/hive/tools/providers.ts"))) as Providers;
});

describe("§4.6 — matches, never a verdict", { skip: !canMock }, () => {
  test("no result anywhere carries a yes/no", async () => {
    // The structural refusal. If a `covered` field ever appears, every other
    // assertion in this file becomes decoration.
    for (const args of [
      {},
      { name: "Badr Al Samaa" },
      { name: "Nowhere Clinic" },
      { location: "Ruwi" },
    ]) {
      const result = await providers.runProviders(args, CTX);
      const keys = Object.keys(result);
      for (const forbidden of ["covered", "inNetwork", "isCovered", "yes", "eligible"]) {
        assert.ok(
          !keys.includes(forbidden),
          `REGRESSION: \`${forbidden}\` is a verdict, and §4.6 forbids the tool producing one`,
        );
      }
      // Every boolean is allow-listed BY NAME rather than banned outright: a
      // flag about the result set is fine (`truncated` says the list was cut),
      // a flag about the provider is the verdict §4.6 rules out. Adding a new
      // boolean therefore has to come past this line and be argued for.
      const ALLOWED_FLAGS = new Set(["truncated"]);
      for (const [k, v] of Object.entries(result)) {
        if (typeof v !== "boolean") continue;
        assert.ok(
          ALLOWED_FLAGS.has(k),
          `\`${k}\` is a new boolean in the tool result — if it says anything about whether a provider is covered, §4.6 forbids it`,
        );
      }
    }
  });

  test("US5-worst: every branch comes back, not the best one", async () => {
    // AC-5.2. "Badr Al Samaa" has three branches in the fixture; returning the
    // top-ranked one is exactly the wrong-branch failure §4.6 describes.
    const result = await providers.runProviders({ name: "Badr Al Samaa" }, CTX);
    assert.equal(result.status, "matches");
    const locations = (result.matches as { location: string }[]).map((m) => m.location);
    assert.deepEqual(locations.sort(), ["Al Khuwair", "Ruwi", "Sohar"]);
  });

  test("a single match is still asked to be confirmed, not affirmed", async () => {
    // The case where the model is most tempted to turn one row into a "yes".
    const result = await providers.runProviders({ name: "Muscat Private Hospital" }, CTX);
    assert.equal((result.matches as unknown[]).length, 1);
    assert.match(String(result.detail), /confirm it is the branch they mean/i);
    assert.match(String(result.detail), /do not answer "yes/i);
  });

  test("entries carry name, type AND location — AC-5.1 names all three", async () => {
    const result = await providers.runProviders({ name: "Badr Al Samaa" }, CTX);
    for (const m of result.matches as Record<string, unknown>[]) {
      assert.ok(m.name && m.location, "name and location are what let the employee pick");
      assert.ok("providerType" in m);
      assert.ok("address" in m, "the address is how they tell two branches apart on the ground");
    }
  });
});

describe("§4.6 — narrowing, and what happens when it fails", { skip: !canMock }, () => {
  test("a town narrows the list", async () => {
    const result = await providers.runProviders({ name: "Badr Al Samaa", location: "Ruwi" }, CTX);
    assert.equal((result.matches as unknown[]).length, 1);
    assert.equal((result.matches as { location: string }[])[0].location, "Ruwi");
  });

  test("a town with no branch still shows the others, and says so", async () => {
    // §4.6's whole point is that the employee picks. Someone who asks about
    // "Badr Al Samaa in Nizwa" and gets an empty result learns nothing; someone
    // who is shown the three real branches learns where to actually go.
    const result = await providers.runProviders({ name: "Badr Al Samaa", location: "Nizwa" }, CTX);
    assert.equal(result.status, "matches");
    assert.equal((result.matches as unknown[]).length, 3);
    assert.match(String(result.note), /Nothing matched in "Nizwa"/);
  });

  test("a branch past the page limit is still found when its town is named", async () => {
    // The narrowing used to happen in JS AFTER the SQL `LIMIT`. For a chain with
    // more branches than one page, the branch the employee actually named could
    // be cut before the filter ever saw it — and the tool would then assert
    // `Nothing matched in "<town>"` about a branch that IS in the list. That is
    // the confident wrong answer §4.6 exists to prevent, arrived at from the
    // opposite direction.
    rows = [
      ...Array.from({ length: 40 }, (_, i) => ({
        ...ROWS[0],
        location: `Town ${String(i).padStart(2, "0")}`,
      })),
      { ...ROWS[0], location: "Zanzibar" },
    ];
    try {
      const result = await providers.runProviders(
        { name: "Badr Al Samaa", location: "Zanzibar" },
        CTX,
      );
      assert.equal(result.status, "matches");
      assert.equal(
        (result.matches as { location: string }[])[0].location,
        "Zanzibar",
        "REGRESSION: the named branch was cut by the page limit before the location filter ran",
      );
      assert.equal(result.note, undefined, "it was found, so there is nothing to apologise for");
    } finally {
      rows = ROWS;
    }
  });

  test("a location on its own is an ordinary filter", async () => {
    const result = await providers.runProviders({ location: "Sohar" }, CTX);
    assert.equal((result.matches as unknown[]).length, 1);
  });

  test("no match says 'could not find', never 'not covered'", async () => {
    // Two different claims. Spelling varies, and the second one sends someone
    // to pay cash at a clinic that direct-bills.
    const result = await providers.runProviders({ name: "Hogwarts Infirmary" }, CTX);
    assert.equal(result.status, "no_match");
    assert.match(String(result.detail), /could not find it rather than that it is not covered/i);
  });

  test("an empty list refuses to guess", async () => {
    rows = [];
    try {
      const result = await providers.runProviders({ name: "Badr Al Samaa" }, CTX);
      assert.equal(result.error, "no_providers");
      assert.match(String(result.detail), /do not guess/i);
      assert.match(String(result.detail), /HR Tag/, "§6.6's phrase, not a generic 'contact HR'");
    } finally {
      rows = ROWS;
    }
  });

  test("nothing named asks for a name and points at the file (AC-5.3)", async () => {
    const result = await providers.runProviders({}, CTX);
    assert.equal(result.status, "need_a_name");
    assert.equal(result.total, ROWS.length);
    assert.match(String(result.detail), /hand over the downloadable list/i);
  });

  test("a long result is capped and says it was", async () => {
    rows = Array.from({ length: 40 }, (_, i) => ({
      ...ROWS[0],
      location: `Town ${String(i).padStart(2, "0")}`,
    }));
    try {
      const result = await providers.runProviders({ name: "Badr Al Samaa" }, CTX);
      assert.equal(result.truncated, true);
      assert.equal((result.matches as unknown[]).length, 25);
      assert.match(String(result.detail), /of more than 25/);
    } finally {
      rows = ROWS;
    }
  });
});

describe("the trigram query is parameterised", { skip: !canMock }, () => {
  test("the needle is a placeholder value, not spliced into the SQL", async () => {
    // `$queryRaw` with a tagged template parameterises; `$queryRawUnsafe` with
    // a built string does not, and the two read almost identically. The repo
    // rule is explicit about this, so it gets an assertion rather than trust.
    await providers.runProviders({ name: "O'Brien Clinic" }, CTX);
    assert.ok(lastRaw, "the raw query did not run");
    assert.ok(
      lastRaw!.values.includes("O'Brien Clinic"),
      "the search term must arrive as a bound VALUE",
    );
    const sql = lastRaw!.strings.join("?");
    assert.doesNotMatch(sql, /O'Brien/, "REGRESSION: the term was spliced into the SQL text");
  });

  test("the query names its columns rather than selecting everything", async () => {
    await providers.runProviders({ name: "Badr Al Samaa" }, CTX);
    const sql = lastRaw!.strings.join(" ");
    assert.doesNotMatch(
      sql,
      /SELECT\s+\*/i,
      "no SELECT * — repo rule, and deletedBy is not the model's business",
    );
    assert.match(sql, /"deletedAt" IS NULL/, "soft-deleted providers must not answer");
  });
});

describe("the provider sheet importer (OQ-7: the 464 rows arrive as data)", () => {
  // `read-excel-file` hands back `unknown[][]`, so this is exactly the shape the
  // script passes in. Nothing here needs a real .xlsx, which is the reason the
  // parsing was split out of the script at all.

  test("headers match by alias, so a real insurer export works", () => {
    // "Wilayat" and "Tel" are what an Omani insurer's sheet actually says. An
    // importer that insists on "Location" and "Phone" sends Alaa to a developer,
    // which is the thing §4.2 exists to prevent.
    const index = mapHeaders(["Provider Name", "Type", "Wilayat", "Address", "Tel"]);
    assert.deepEqual(index, { name: 0, providerType: 1, location: 2, address: 3, phone: 4 });
  });

  test("case, spacing and punctuation in a header do not matter", () => {
    const index = mapHeaders(["  PROVIDER_NAME ", "Provider Type", "City"]);
    assert.equal(index.name, 0);
    assert.equal(index.providerType, 1);
    assert.equal(index.location, 2);
  });

  test("a missing required column is reported, not guessed at", () => {
    const result = parseProviderSheet([
      ["Provider Name", "Tel"],
      ["A Clinic", "+968 1"],
    ]);
    assert.deepEqual(result.missingColumns, ["location"]);
    assert.equal(result.parsed.length, 0, "nothing is imported from a sheet we cannot read");
  });

  test("an optional column being absent does not fail the file", () => {
    // An export without a phone column is common; refusing all 464 rows over it
    // would help nobody.
    const result = parseProviderSheet([
      ["Name", "Location"],
      ["Badr Al Samaa Hospital", "Ruwi"],
    ]);
    assert.deepEqual(result.missingColumns, []);
    assert.equal(result.parsed[0].phone, null);
    assert.equal(result.parsed[0].providerType, null);
  });

  test("an unimportable row is REPORTED with its line, never dropped quietly", () => {
    // The rule that matters most. A silent skip in a 464-row import is how a
    // clinic goes missing, and nobody finds out until an employee is told —
    // wrongly — that they are not covered.
    const result = parseProviderSheet([
      ["Name", "Location"],
      ["Badr Al Samaa Hospital", "Ruwi"],
      ["No Location Clinic", "   "],
      ["", "Sohar"],
      ["Aster Al Raffah", "Ghubra"],
    ]);
    assert.equal(result.parsed.length, 2, "the good rows still import");
    assert.deepEqual(result.skipped, [
      { line: 3, reason: "no location" },
      { line: 4, reason: "no name" },
    ]);
  });

  test("skipped line numbers match what Alaa sees in the spreadsheet", () => {
    // 1-based, header counted. An off-by-one here sends her to the wrong row.
    const result = parseProviderSheet([
      ["Name", "Location"],
      ["", "Ruwi"],
    ]);
    assert.equal(result.skipped[0].line, 2);
  });

  test("a typed cell survives — a phone number arrives as a number", () => {
    // Entered without its "+", a phone comes back from the spreadsheet as a
    // JavaScript number. A `typeof x === "string"` check would drop it.
    const index = mapHeaders(["Name", "Location", "Phone"]);
    assert.equal(cell(["A", "Ruwi", 96824799760], index, "phone"), "96824799760");
    assert.equal(cell(["A", "Ruwi", null], index, "phone"), null);
    assert.equal(cell(["A", "Ruwi", "  "], index, "phone"), null, "whitespace is not a phone");
  });

  test("an address with a comma and a newline survives intact", () => {
    // The two things the hand-rolled CSV parser this replaced got wrong. Reading
    // the .xlsx directly means they were never at risk — this pins that.
    const result = parseProviderSheet([
      ["Name", "Location", "Address"],
      ["Comma Clinic", "Barka", "Way 2701,\nAl Khuwair"],
    ]);
    assert.equal(result.parsed[0].address, "Way 2701,\nAl Khuwair");
  });

  test("an empty sheet is a missing header, not a crash", () => {
    const result = parseProviderSheet([]);
    assert.deepEqual(result.missingColumns, ["name", "location"]);
  });

  test("the first matching column wins when a sheet has two candidates", () => {
    const index = mapHeaders(["Name", "Facility", "Location"]);
    assert.equal(index.name, 0, "the earlier column is the one the author meant");
  });
});

describe("the import script's destructive path", () => {
  // Source-level assertions, and weak on purpose: the script needs a real
  // `.xlsx` and a live database, so what is pinned here is that the four
  // properties a review found missing cannot be reverted silently. The
  // behaviour itself was verified by running `deleteMany` inside a transaction
  // against Postgres — it soft-deletes and writes one audit row per record.
  const script = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../scripts/hive-import-providers.mjs",
    ),
    "utf8",
  );

  test("--replace goes through deleteMany, which is audited; updateMany is not", () => {
    // The soft-delete extension rewrites `deleteMany` into the `deletedAt`
    // stamp AND writes an audit row per record. A hand-written `updateMany`
    // is hooked by neither, so retiring 464 rows left no trace at all.
    assert.match(script, /tx\.networkProvider\.deleteMany/);
    assert.doesNotMatch(
      script,
      /networkProvider\.updateMany/,
      "REGRESSION: an unaudited bulk write retiring the whole provider list",
    );
  });

  test("the wipe and the insert are one transaction", () => {
    // Otherwise a `--replace` that dies partway leaves the list half-retired,
    // and the rows that never arrived look like providers that are genuinely
    // not in the network.
    assert.match(script, /auditedTransaction\(/);
  });

  test("a file that parsed to nothing changes nothing", () => {
    // `--replace` on an empty parse would wipe the list and leave every
    // employee told the list has not been uploaded yet.
    assert.match(script, /parsed\.length === 0/);
  });

  test("the process disconnects and reports errors as one line", () => {
    assert.match(script, /\$disconnect\(\)/, "the pg pool otherwise keeps the command hanging");
    assert.match(script, /main\(\)\.catch/, "a bad path should not be a stack trace");
  });
});

describe("the seed seeds no providers at all", () => {
  const seed = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed-hive.ts"),
    "utf8",
  );

  test("HR Centre never seeds HIVE's placeholder clinics (operator: real config only)", () => {
    // HIVE seeded twelve fabricated clinics into an empty table. HR Centre's
    // seed runs in production, where an invented clinic with an invented phone
    // number is the precise harm §4.6 exists to prevent — so none are seeded;
    // the real list arrives via `npm run hive:providers`.
    assert.doesNotMatch(seed, /networkProvider\.create/);
    assert.doesNotMatch(seed, /Badr Al Samaa/);
  });
});
