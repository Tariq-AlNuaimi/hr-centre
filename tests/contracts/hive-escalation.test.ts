import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { orgDouble, pairsToDb } from "./_hive-org-double";

// §5.4's escalation capture (US9, AC-9.1, AC-9.2, AC-9.3).
//
// Three properties carry the weight here, and each fails silently:
//
//   1. **Nothing is ever SENT.** §5.4 step 5 requires the HR Manager's approval
//      on every single answer, no exceptions. The row this writes must be `NEW`
//      and inert — and `escalate` is the one non-read-only tool on an anonymous
//      surface (ADR-068), so "the worst a prompt-injected model can do is queue
//      a row a person reads" is the whole safety argument.
//   2. **No timeframe, anywhere.** AC-9.3. "We'll get back to you shortly" is
//      the single most natural sentence to say at this moment, and the spec
//      forbids it, so the tool result must not contain a field or a phrase the
//      model can repeat.
//   3. **Routing matches what HIVE already told them.** The escalation uses the
//      SAME module as the `hr_tag` tool. A second implementation would drift,
//      and the employee would be told "your HR Tag is Rahma and Mohammed" and
//      then have the question land with a different pair.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** The ticket prefix the settings double returns (default, or a test's rename). */
let ticketPrefix = "HIVE";

/** Notifications the services asked for (US-T5). */
let notified: string[] = [];

type Escalate = typeof import("../../lib/hive/tools/escalate.ts");
type Service = typeof import("../../lib/hive/services/escalation.ts");
let escalate: Escalate;
let service: Service;

const CTX = {
  companyId: null,
  orgUnitId: null,
  sessionId: null,
  source: "SIRAAJ" as const,
  identityVerified: false,
};

const COMPANIES = [
  { id: "c-rihal", name: "Rihal", units: [{ id: "u-tech" }, { id: "u-ops" }] },
  { id: "c-tp", name: "Transformation Pioneers", units: [{ id: "t-ops" }] },
];

const PAIRS = [
  {
    id: "p-tech",
    name: "Rahma Adam & Mohammed Al Amri",
    isDefault: false,
    members: [{ name: "Rahma Adam", email: "r@rihal.om", phone: null, photoKey: null, order: 1 }],
    coverage: [
      {
        label: "Technology & Development Directorate",
        aliases: ["Tech", "DevOps"],
        companyId: null,
        orgUnitId: "u-tech",
      },
      {
        // Linked to one of TP's OWN units, on a pair that is not TP's
        // company-wide pair. Company scoping cannot exclude this one, so the
        // step ORDER is the only thing keeping §6.6's "TP routes directly to
        // Siham & Alaa" true — and the escalation must agree with the `hr_tag`
        // tool, or the employee is told one pair and the question reaches
        // another.
        label: "TP Operations",
        aliases: ["Operations"],
        companyId: null,
        orgUnitId: "t-ops",
      },
    ],
  },
  {
    id: "p-default",
    name: "Siham Al Hadhrami & Alaa Al Hinai",
    isDefault: true,
    members: [
      { name: "Siham Al Hadhrami", email: "s@rihal.om", phone: null, photoKey: null, order: 1 },
    ],
    coverage: [
      {
        label: "Transformation Pioneers (all)",
        aliases: ["TP"],
        companyId: "c-tp",
        orgUnitId: null,
      },
    ],
  },
  {
    // Two pairs claiming the same alias — a configuration §4.2 lets Alaa create.
    id: "p-ambig-a",
    name: "Ambiguous A",
    isDefault: false,
    members: [{ name: "A", email: "a@rihal.om", phone: null, photoKey: null, order: 1 }],
    coverage: [{ label: "Shared A", aliases: ["Legal"], companyId: null, orgUnitId: "u-ops" }],
  },
  {
    id: "p-ambig-b",
    name: "Ambiguous B",
    isDefault: false,
    members: [{ name: "B", email: "b@rihal.om", phone: null, photoKey: null, order: 1 }],
    coverage: [{ label: "Shared B", aliases: ["Legal"], companyId: null, orgUnitId: "u-ops" }],
  },
];

let pairRows: typeof PAIRS = PAIRS;
const written: Record<string, unknown>[] = [];
const opened: Record<string, unknown>[] = [];
const audited: Record<string, unknown>[] = [];
/** An escalation the dedupe probe should find, or null for "nothing queued". */
let existing: Record<string, unknown> | null = null;
/** The `where` of every dedupe / cap probe. */
let probes: Record<string, unknown>[] = [];
/** Unverified-identity SIRAAJ tickets in the last hour, company-wide. */
let unverifiedCount = 0;
/** How many escalations this session already raised in the last hour. */
let recentCount = 0;

function reset() {
  ticketPrefix = "HIVE";
  written.length = 0;
  opened.length = 0;
  audited.length = 0;
  existing = null;
  probes = [];
  notified = [];
  unverifiedCount = 0;
  recentCount = 0;
  pairRows = PAIRS;
}

before(async () => {
  if (!canMock) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hand-rolled Prisma double
  const prismaMock: any = {
    // Interactive transactions run the callback against the same double.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    // Spec V2 §8.8: the OPENED history line, written with the row.
    escalationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        opened.push(data);
        return { id: `ev-${opened.length}` };
      },
    },
    hrTagPair: { findMany: async () => pairsToDb(pairRows) },
    // HR Centre: companies are core OrgEntity rows (tests/contracts/_hive-org-double.ts).
    ...orgDouble(COMPANIES, {}),
    // ADR-079 §7: the ticket links to the Employee with that email, if any.
    employee: { findFirst: async () => null },
    escalation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        written.push(data);
        return {
          id: `esc-${written.length}`,
          ticketNumber: 40 + written.length,
          threadKey: `thread-${written.length}`,
          hrPairId: data.hrPairId,
        };
      },
      // The dedupe probe and the per-EMAIL cap (ADR-075). `existing` is what a test
      // sets to simulate a row already being there.
      findFirst: async (q: { where: Record<string, unknown> }) => {
        probes.push(q.where);
        return existing;
      },
      count: async (q: { where: Record<string, unknown> }) => {
        probes.push(q.where);
        return q.where.employeeEmail ? recentCount : unverifiedCount;
      },
    },
    // `recordAudit` writes through this. Captured rather than stubbed away:
    // "routed to the default because the directorate was ambiguous" is the
    // sentence that explains a misroute months later, and a test that let it
    // silently disappear would be pinning nothing.
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return data;
      },
    },
  };
  // US-T5: notifications are captured, not sent — their own suite covers them.
  mockApi.module!(import.meta.resolve("../../lib/hive/services/ticket-notify.ts"), {
    namedExports: {
      notifyTicket: (kind: string, id: string) => notified.push(`${kind}:${id}`),
    },
  });
  // Spec V2 §8.8 Settings (T5): the prefix HR set. Switchable per test.
  mockApi.module!(import.meta.resolve("../../lib/hive/services/ticket-settings.ts"), {
    namedExports: {
      getTicketSettings: async () => ({ ticketPrefix, statusLabels: {} }),
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: prismaMock,
      auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) => prismaMock.$transaction(fn),
    },
  });
  escalate = (await import(import.meta.resolve("../../lib/hive/tools/escalate.ts"))) as Escalate;
  service = (await import(import.meta.resolve("../../lib/hive/services/escalation.ts"))) as Service;
});

const GOOD = {
  employeeName: "Sara Al Balushi",
  employeeEmail: "Sara.Balushi@rihal.om",
  question: "Can I carry over 15 days?",
};

describe("§5.4 — the row is inert, and stays inert", { skip: !canMock }, () => {
  test("a created escalation is OPEN, unsent, unapproved — with a ticket and history", async () => {
    reset();
    await escalate.runEscalate({ ...GOOD, directorate: "DevOps" }, CTX);
    assert.equal(written.length, 1);
    const row = written[0];
    assert.equal(row.status, "OPEN", "§5.4 step 5: every answer needs the HR Manager's approval");
    assert.deepEqual(opened, [
      { escalationId: "esc-1", kind: "OPENED", actorId: null, note: null },
    ]);
    // Nothing in this path may pre-fill any part of the send.
    for (const forbidden of ["sentAt", "approvedAt", "approvedById", "draftAnswer"]) {
      assert.equal(row[forbidden], undefined, `\`${forbidden}\` must be set by a human, later`);
    }
  });

  test("status is written explicitly, not left to a column default", async () => {
    // A default is a thing a migration can change without anyone reading the
    // service, and `OPEN` is the entire safety property here.
    reset();
    await escalate.runEscalate({ ...GOOD }, CTX);
    assert.ok("status" in written[0], "REGRESSION: OPEN now depends on the schema default");
  });

  test("ADR-075: the duplicate check and hourly cap are keyed on the EMPLOYEE, not a session", async () => {
    reset();
    await escalate.runEscalate({ ...GOOD }, CTX);
    assert.ok(probes.length >= 2, "both the dedupe probe and the cap ran");
    for (const where of probes.slice(0, 2)) {
      assert.equal(where.employeeEmail, "sara.balushi@rihal.om");
      assert.ok(!("sessionId" in where), "a null session would make the check vacuous");
    }
  });

  test("an UNVERIFIED Siraaj ticket counts against a company-wide hourly ceiling", async () => {
    // Without a forwarded identity the email is the model's say-so; varying it
    // would dodge the per-email cap. 30 an hour is the backstop.
    reset();
    unverifiedCount = 30;
    const result = await escalate.runEscalate({ ...GOOD }, CTX);
    assert.equal(result.status, "already_raised");
    assert.equal(written.length, 0);
    const global = probes.at(-1)!;
    assert.deepEqual(Object.keys(global).sort(), ["createdAt", "identityVerified", "source"]);
  });

  test("a VERIFIED ticket is not held to that ceiling", async () => {
    reset();
    unverifiedCount = 30;
    await escalate.runEscalate({ ...GOOD }, { ...CTX, identityVerified: true });
    assert.equal(written.length, 1);
    assert.equal(written[0].identityVerified, true);
  });

  test("US-T5: a new ticket notifies its pair; a duplicate does not", async () => {
    reset();
    await escalate.runEscalate({ ...GOOD }, CTX);
    assert.deepEqual(notified, ["opened:esc-1"]);
    reset();
    existing = {
      id: "esc-old",
      ticketNumber: 9,
      threadKey: "t",
      hrPair: { name: "Rahma Adam & Mohammed Al Amri" },
    };
    await escalate.runEscalate({ ...GOOD }, CTX);
    assert.deepEqual(notified, [], "the pair already heard about the original");
  });

  test("ADR-075: a ticket records where it came from", async () => {
    reset();
    await escalate.runEscalate({ ...GOOD }, CTX);
    assert.equal(written[0].source, "SIRAAJ");
    assert.ok(
      !("sessionId" in written[0]),
      "no HIVE chat session exists any more (column not ported)",
    );
    assert.equal(written[0].employeeId, null, "ADR-079: no Employee has this email in the double");
  });
});

describe("AC-9.3 — no timeframe, in any branch", { skip: !canMock }, () => {
  test("nothing the tool returns promises or implies when", async () => {
    const results = [
      await escalate.runEscalate({}, CTX),
      await escalate.runEscalate({ ...GOOD }, CTX),
      await escalate.runEscalate({ ...GOOD, employeeEmail: "sara@gmail.com" }, CTX),
    ];
    for (const result of results) {
      const text = JSON.stringify(result);
      for (const phrase of [
        "shortly",
        "within 24",
        "within 48",
        "business day",
        "working day",
        "as soon as possible",
        "turnaround",
        "response time",
      ]) {
        assert.doesNotMatch(
          text,
          new RegExp(phrase, "i"),
          `REGRESSION: "${phrase}" is a timeframe, and AC-9.3 forbids stating or implying one`,
        );
      }
      // No structured field a model could read a date out of, either.
      for (const k of Object.keys(result)) {
        assert.ok(
          !/^(eta|expectedBy|dueAt|slaHours|respondBy)$/i.test(k),
          `\`${k}\` is a timeframe field`,
        );
      }
    }
  });

  test("the confirmation tells the model NOT to promise one", async () => {
    const result = await escalate.runEscalate({ ...GOOD }, CTX);
    assert.equal(result.status, "raised");
    assert.match(String(result.detail), /Say nothing at all about WHEN/i);
  });
});

describe("AC-9.1 — nothing is written before they agree", { skip: !canMock }, () => {
  test("called with no identity it asks, and writes nothing", async () => {
    reset();
    const result = await escalate.runEscalate({ question: "Who approves overtime?" }, CTX);
    assert.equal(result.status, "need_identity");
    assert.equal(written.length, 0, "REGRESSION: a partial record of someone who never agreed");
  });

  test("the ask is for both fields TOGETHER — §5.4 says one step", async () => {
    const result = await escalate.runEscalate({ question: "Who approves overtime?" }, CTX);
    assert.match(String(result.detail), /TOGETHER/);
    assert.match(
      String(result.detail),
      /not\s+earlier in the conversation/i,
      "AC-9.1: never upfront",
    );
  });

  test("a personal address is refused, and nothing is written", async () => {
    // This address is what the approved answer is SENT to (§5.4 step 6). An
    // unvalidated domain means HR's answer, written for one employee, goes
    // wherever a stranger typed.
    reset();
    const result = await escalate.runEscalate({ ...GOOD, employeeEmail: "sara@gmail.com" }, CTX);
    assert.equal(result.status, "need_identity");
    assert.match(String(result.detail), /work email/i);
    assert.equal(written.length, 0);
  });

  test("a rejected address outranks a missing question", async () => {
    // Otherwise someone who typed a personal address is asked to restate their
    // question and left to type the same address again.
    const result = await escalate.runEscalate(
      { employeeName: "Sara Al Balushi", employeeEmail: "sara@gmail.com" },
      CTX,
    );
    assert.equal(result.status, "need_identity");
    assert.match(String(result.detail), /personal address/i);
  });

  test("a missing question is not invented from the conversation", async () => {
    reset();
    const result = await escalate.runEscalate(
      { employeeName: GOOD.employeeName, employeeEmail: GOOD.employeeEmail },
      CTX,
    );
    assert.equal(result.status, "need_question");
    assert.match(String(result.detail), /Do not invent the question/i);
    assert.equal(written.length, 0);
  });
});

describe("AC-9.2 — routed by the same rules HIVE told them", { skip: !canMock }, () => {
  test("a directorate routes to its pair", async () => {
    const routed = await service.routeEscalation({ directorate: "DevOps" });
    assert.equal(routed?.pairName, "Rahma Adam & Mohammed Al Amri");
    assert.equal(routed?.matchedOn, "directorate");
  });

  test("a company that routes wholesale beats the directorate — the TP trap", async () => {
    // "Operations" here is linked to a TP unit on the Tech pair, so company
    // scoping cannot rule it out and only the step order settles it.
    const routed = await service.routeEscalation({
      company: "Transformation Pioneers",
      directorate: "Operations",
    });
    assert.equal(
      routed?.pairName,
      "Siham Al Hadhrami & Alaa Al Hinai",
      "REGRESSION: escalation routing disagrees with what the hr_tag tool answers",
    );
    assert.equal(routed?.matchedOn, "company");
  });

  test("§3.5's selector routes when nothing was said", async () => {
    const routed = await service.routeEscalation({ orgUnitId: "u-tech" });
    assert.equal(routed?.pairName, "Rahma Adam & Mohammed Al Amri");
    assert.equal(routed?.matchedOn, "selector");
  });

  test("an unroutable escalation still lands — on the pair HR marked default", async () => {
    // The tool can ask "which directorate?" because a conversation can ask
    // again. An escalation cannot: they have already given their name, their
    // email and their question.
    const routed = await service.routeEscalation({ directorate: "Wizarding" });
    assert.equal(routed?.pairName, "Siham Al Hadhrami & Alaa Al Hinai");
    assert.equal(routed?.matchedOn, "default");
  });

  test("an AMBIGUOUS directorate goes to the default, not to a coin flip", async () => {
    // `matchDirectorate` returns an ambiguity rather than a card here. For a
    // conversation that is an answer; for an escalation it is not a routing
    // decision, and picking one of two pairs at random is worse than the pair
    // HR chose.
    const routed = await service.routeEscalation({ directorate: "Legal" });
    assert.equal(
      routed?.matchedOn,
      "default_ambiguous",
      "REGRESSION: an ambiguity was treated as a routing decision",
    );
    assert.ok(!routed?.pairName.startsWith("Ambiguous"));
  });

  test("with no staffed pair at all, nothing is written and nothing is claimed", async () => {
    reset();
    pairRows = [];
    try {
      const result = await escalate.runEscalate({ ...GOOD }, CTX);
      assert.equal(result.error, "no_hr_pairs");
      assert.match(String(result.detail), /do not claim it has been sent/i);
      assert.equal(written.length, 0);
    } finally {
      pairRows = PAIRS;
    }
  });
});

describe("what review found — the routing drifts", { skip: !canMock }, () => {
  test("an UNRECOGNISED company does not silently switch scoping off", async () => {
    // Dropping `resolveCompany`'s `unknown` flag left `company` null, which
    // disables company scoping entirely — so "Operations" for someone at
    // "Transformation Pioneers Ltd" matched the RIHAL Operations coverage and
    // filed the question with a pair that does not cover them. The `hr_tag`
    // tool answers `company_unknown` here and names nobody.
    const routed = await service.routeEscalation({
      company: "Transformation Pioneers Ltd",
      directorate: "Operations",
    });
    assert.equal(routed?.matchedOn, "default_unknown_company");
    assert.equal(
      routed?.pairName,
      "Siham Al Hadhrami & Alaa Al Hinai",
      "REGRESSION: an unidentifiable company was routed by another company's directorate",
    );
  });

  test("an ambiguity no longer discards a selector that resolves cleanly", async () => {
    // `ambiguous_directorate` is non-null, so it used to stop the `??` chain
    // before `matchSelector` ever ran — throwing away a §3.5 selector that
    // answers the question exactly.
    const routed = await service.routeEscalation({ directorate: "Legal", orgUnitId: "u-tech" });
    assert.equal(routed?.matchedOn, "selector");
    assert.equal(routed?.pairName, "Rahma Adam & Mohammed Al Amri");
  });

  test("the pair is identified by id, not by display name", async () => {
    // `HrTagPair.name` has no unique constraint. Two pairs sharing a name filed
    // the row against whichever sorted first while returning the right name to
    // the employee — a misroute invisible from both ends.
    reset();
    // The DECOY sorts first, so a lookup by display name finds the wrong one.
    // With the real pair first the two approaches agree and the test pins
    // nothing — which is exactly what mutation testing caught.
    pairRows = [
      { ...PAIRS[1], id: "p-decoy", name: "Same Name", isDefault: true, coverage: [] },
      { ...PAIRS[0], id: "p-real", name: "Same Name" },
    ];
    try {
      await escalate.runEscalate({ ...GOOD, directorate: "DevOps" }, CTX);
      assert.equal(
        written[0].hrPairId,
        "p-real",
        "REGRESSION: the row was filed against a pair recovered by display name",
      );
    } finally {
      reset();
    }
  });
});

describe("the one write on an anonymous surface", { skip: !canMock }, () => {
  test("an identical question is not queued twice", async () => {
    // The engine runs up to four tool rounds and its exhaustion path leaves the
    // employee looking at a failure with the row already committed — so trying
    // again is the natural next move. Without dedupe, one person asking one
    // question gives HR four identical items to read.
    reset();
    existing = {
      id: "esc-old",
      threadKey: "t-old",
      hrPair: { name: "Rahma Adam & Mohammed Al Amri" },
    };
    try {
      const result = await escalate.runEscalate({ ...GOOD }, CTX);
      assert.equal(result.status, "already_raised");
      assert.equal(written.length, 0, "REGRESSION: a duplicate escalation was written");
      assert.match(String(result.detail), /nothing new was raised/i);
      assert.match(String(result.detail), /Say nothing about WHEN/i, "AC-9.3 still applies here");
    } finally {
      reset();
    }
  });

  test("spec V2 §8.6: a raised escalation hands back its ticket ID for the card", async () => {
    reset();
    const result = await escalate.runEscalate({ ...GOOD }, CTX);
    assert.equal(result.status, "raised");
    assert.equal(result.ticket, "HIVE-0041");
    assert.equal(result.replyTo, "sara.balushi@rihal.om");
    assert.match(String(result.detail), /HIVE-0041/, "the model can name the ticket");
  });

  test("§8.8 Settings: Siraaj is handed the ID with the prefix HR set", async () => {
    reset();
    ticketPrefix = "HR";
    const result = await escalate.runEscalate({ ...GOOD }, CTX);
    assert.equal(result.ticket, "HR-0041");
    assert.match(String(result.detail), /HR-0041/);
    reset();
  });

  test("a session cannot queue an unbounded number of escalations", async () => {
    // The blueprint puts 3/hr/session on the escalation route. As a model tool
    // there is no route for `withRateLimit` to wrap, so the cap is counted from
    // the rows — which is also the only place that survives a restart.
    reset();
    recentCount = 3;
    try {
      const result = await escalate.runEscalate({ ...GOOD }, CTX);
      assert.equal(result.status, "already_raised");
      assert.equal(written.length, 0);
    } finally {
      reset();
    }
  });

  test("the cap does not fire below the limit", async () => {
    reset();
    recentCount = 2;
    try {
      const result = await escalate.runEscalate({ ...GOOD }, CTX);
      assert.equal(result.status, "raised");
      assert.equal(written.length, 1);
    } finally {
      reset();
    }
  });

  test("WHERE and WHY it routed are both recorded", async () => {
    // The audit row's `after` held only {id, threadKey}, so a misroute was
    // unexplainable after the fact. There is no column for the reason and
    // adding one is a migration, so it is its own audit entry.
    reset();
    await escalate.runEscalate({ ...GOOD, directorate: "DevOps" }, CTX);
    assert.equal(written[0].hrPairId, "p-tech", "the row itself carries where");
    const entry = audited.find((a) => String(a.entityType) === "Escalation");
    assert.ok(entry, "REGRESSION: the routing decision was not recorded anywhere");
    const after = entry!.after as Record<string, unknown>;
    assert.equal(after.matchedOn, "directorate");
    assert.equal(after.routedTo, "Rahma Adam & Mohammed Al Amri");
  });
});

describe("what the tool asks for when the input is wrong", { skip: !canMock }, () => {
  test("a BLANK email is not reported as a bad address", async () => {
    // `typeof === "string"` was true for "", so someone who had given nothing
    // was told their address looked wrong — and the missing name went
    // unmentioned.
    const result = await escalate.runEscalate({ employeeEmail: "", question: GOOD.question }, CTX);
    assert.equal(result.status, "need_identity");
    assert.doesNotMatch(String(result.detail), /does not look like/i);
    assert.match(String(result.detail), /full name and work email TOGETHER/i);
  });

  test("a question that is too LONG says so, rather than asking to restate it", async () => {
    // "Do not invent the question" cannot fix a length failure: the model
    // re-sends the same 3,000 characters until the engine gives up, and the
    // employee sees a failure for a question that was perfectly clear.
    const result = await escalate.runEscalate({ ...GOOD, question: "x".repeat(3000) }, CTX);
    assert.equal(result.status, "need_question");
    assert.match(String(result.detail), /too long/i);
    assert.match(String(result.detail), /short version/i);
    assert.doesNotMatch(String(result.detail), /Do not invent/i);
  });
});
