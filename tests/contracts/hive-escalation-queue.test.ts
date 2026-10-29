import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// §5.4's queue, approval gate and send (US10, US11).
//
// One rule dominates this file, and the spec leaves no room in it:
//
//   "The HR Manager (Muna) reviews and approves — required for every single
//    answer, no exceptions, regardless of who drafted it."
//
// with AC-11.1 restating it as "no exception path" and AC-10.2 adding that a
// user without the permission gets a 403 "not merely hidden". So the tests
// below are mostly about REFUSALS, and about the two orderings that decide
// whether an employee's answer is real:
//
//   - APPROVED is written before the send is attempted, so a human decision
//     survives a transport failure and a SEND_FAILED row is resumable.
//   - SENT is written only after the send is known to have worked. The tempting
//     shape — mark SENT, then send — is one crash away from an employee never
//     hearing back while the record says they did (AC-11.4).

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** The ticket prefix the settings double returns (default, or a test's rename). */
let ticketPrefix = "HIVE";

/** Notifications the services asked for (US-T5). */
let notified: string[] = [];

/** Escalation ids a reply token was minted for (ADR-070). */
const mintedFor: string[] = [];
/** `AUTH_URL`, or null for a deployment that has not configured one. */
let authUrl: string | null = "https://hive.example";

type Queue = typeof import("../../lib/hive/services/escalation-queue.ts");
let queue: Queue;

let rows: Record<string, Record<string, unknown>> = {};
let updates: Record<string, unknown>[] = [];
let sent: { to: string; subject: string; text: string }[] = [];
let messages: Record<string, unknown>[] = [];
/** EscalationEvent rows written (spec V2 §8.8 history). */
let events: { escalationId: string; kind: string; actorId: string | null; note: string | null }[] =
  [];
let approvers = new Set<string>(["muna", "siham"]);
/** People whose grants are scoped to one pair (ADR-073 OWN_PAIR). */
let ownPair: Record<string, string> = {};
let sendBehaviour: "ok" | "unsent" | "throw" = "ok";
let template: { subject: string; body: string } | null = null;
/** Runs mid-send — how a test puts an employee reply inside the send window. */
let duringSend: (() => void) | null = null;
/** What the queue query actually asked the database for. */
let lastCountWhere: Record<string, unknown> | null = null;
let lastQuery: {
  take?: number;
  select: Record<string, unknown>;
  orderBy?: { [k: string]: string }[];
} | null = null;

function reset() {
  ticketPrefix = "HIVE";
  rows = {
    e1: {
      id: "e1",
      // Present on the row on purpose: AC-10.1's "no transcripts" check needs
      // something that COULD leak, or it passes vacuously.
      sessionId: "sess-secret-1",
      ticketNumber: 43,
      hrPairId: "pair-rahma",
      draftedById: "rahma",
      updatedAt: new Date(),
      status: "PENDING_APPROVAL",
      employeeName: "Sara Al Balushi",
      employeeEmail: "sara.balushi@rihal.om",
      question: "Can I carry over 15 days?",
      draftAnswer: "Yes — up to 10 days carry over automatically.",
      hrPair: { name: "Rahma Adam & Mohammed Al Amri" },
    },
  };
  updates = [];
  sent = [];
  messages = [];
  events = [];
  notified = [];
  mintedFor.length = 0;
  authUrl = "https://hive.example";
  approvers = new Set(["muna", "siham"]);
  ownPair = {};
  sendBehaviour = "ok";
  template = null;
  duringSend = null;
  lastQuery = null;
  lastCountWhere = null;
}

/** Does `row` satisfy a Prisma-style `where` (equality, `in`, `not`)? */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown };
      if (c.in) return c.in.includes(value);
      if ("not" in c) return value !== c.not;
    }
    return value === cond;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hand-rolled Prisma double
const prismaMock: any = {
  escalation: {
    findUnique: async ({ where }: { where: { id: string } }) => rows[where.id] ?? null,
    // Honours `select` and `take`. A mock that returned whole rows
    // regardless made both the AC-10.1 leak check and the page bound
    // untestable — adding `sessionId` to the select, or deleting `take`,
    // changed nothing observable. Mutation testing caught both.
    findMany: async ({
      select,
      take,
      cursor,
      skip,
      orderBy,
    }: {
      select: Record<string, unknown>;
      take?: number;
      cursor?: { id: string };
      skip?: number;
      orderBy?: { [k: string]: string }[];
    }) => {
      lastQuery = { take, select, orderBy };
      let all = Object.values(rows);
      if (cursor) {
        const at = all.findIndex((r) => r.id === cursor.id);
        all = at >= 0 ? all.slice(at + (skip ?? 0)) : all;
      }
      const projected = all.map((r) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (key in r) out[key] = r[key];
        }
        return out;
      });
      return typeof take === "number" ? projected.slice(0, take) : projected;
    },
    // US-T6's chip counts. The filter is recorded so a test can assert the
    // counts ignore the status filter.
    groupBy: async ({ where }: { where: Record<string, unknown> }) => {
      lastCountWhere = where;
      const by = new Map<string, number>();
      for (const r of Object.values(rows))
        by.set(r.status as string, (by.get(r.status as string) ?? 0) + 1);
      return [...by].map(([status, n]) => ({ status, _count: { _all: n } }));
    },
    // A conditional single-row update, like Prisma's: every filter in
    // `where` must hold, or it throws P2025 and writes nothing. The state
    // machine's race safety (blueprint W4) lives in that `where`, so a mock
    // that ignored it would pass a service that forgot to filter.
    update: async ({
      where,
      data,
    }: {
      where: Record<string, unknown> & { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = rows[where.id];
      if (!row || !matches(row, where)) {
        throw Object.assign(new Error("No record found"), { code: "P2025" });
      }
      updates.push({ id: where.id, ...data });
      // `@updatedAt`: every write bumps it, as Prisma does.
      Object.assign(row, data, { updatedAt: new Date() });
      return { id: where.id };
    },
  },
  escalationEvent: {
    create: async ({ data }: { data: (typeof events)[number] }) => {
      events.push(data);
      return { id: `ev${events.length}` };
    },
  },
  // Interactive transactions run the callback against the same mock: the
  // atomicity is Postgres's job; what this suite checks is what is written.
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
  escalationMessage: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      messages.push({ at: new Date(), ...data });
      return data;
    },
    // Newest matching message: `direction`, plus an optional `at: { gte }`.
    findFirst: async ({ where }: { where: { direction: string; at?: { gte: Date } } }) =>
      messages
        .filter((m) => m.direction === where.direction)
        .filter((m) => !where.at || (m.at as Date) >= where.at.gte)
        .at(-1) ?? null,
  },
  // The core template store (ADR-095).
  emailTemplate: {
    findUnique: async () =>
      template
        ? {
            key: "escalation-answer",
            ...template,
            ccRecipients: [],
            updatedAt: new Date(),
            updatedBy: null,
          }
        : null,
  },
};

before(async () => {
  if (!canMock) return;
  // `escalation-queue.ts` reads `AUTH_URL` to build ADR-070's reply link and
  // mints the token through `reply-token.ts`. Both are replaced here: the link
  // is what this suite asserts about, and the real token module would want a
  // database.
  mockApi.module!(import.meta.resolve("../../lib/env.ts"), {
    namedExports: {
      // A getter, so a test can change it: `env` is read at call time in the
      // service, and a frozen object here would make the unconfigured case
      // untestable.
      env: {
        get AUTH_URL() {
          return authUrl;
        },
      },
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/hive/reply-token.ts"), {
    namedExports: {
      issueReplyToken: async (id: string) => {
        mintedFor.push(id);
        return "TOKEN-" + id;
      },
      replyLinkFor: (origin: string, raw: string) => `${origin}/reply/${raw}`,
      revokeReplyTokens: async () => 0,
      REPLY_TOKEN_TTL_MS: 30 * 24 * 60 * 60 * 1000,
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/hive/services/permissions.ts"), {
    namedExports: {
      hasHivePermission: async (userId: string, action: string) =>
        action === "approve" ? approvers.has(userId) : true,
      // ADR-073: pair scope. `ownPair` restricts a person to one pair; anyone
      // not in it holds their permission for all pairs.
      canOnPair: async (userId: string, action: string, pairId: string) => {
        if (action === "approve" && !approvers.has(userId)) return false;
        return ownPair[userId] === undefined || ownPair[userId] === pairId;
      },
    },
  });
  // US-T5: notifications are captured, not sent — their own suite covers them.
  mockApi.module!(import.meta.resolve("../../lib/hive/services/ticket-notify.ts"), {
    namedExports: {
      notifyTicket: (kind: string, id: string) => notified.push(`${kind}:${id}`),
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/email.ts"), {
    namedExports: {
      isEmailEnabled: () => sendBehaviour !== "unsent",
      sendEmail: async (o: { to: string; subject: string; text: string }) => {
        if (sendBehaviour === "throw") {
          throw new Error("smtp refused: 550 mailbox unavailable for sara.balushi@rihal.om");
        }
        sent.push(o);
        duringSend?.();
        return { sent: sendBehaviour === "ok" };
      },
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
      auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    },
  });
  queue = (await import(
    import.meta.resolve("../../lib/hive/services/escalation-queue.ts")
  )) as Queue;
});

describe("AC-11.1 — approval is required, with no way around it", { skip: !canMock }, () => {
  test("a user without approval (an EDITOR, ADR-072) is refused", async () => {
    reset();
    const result = await queue.approveAndSend("e1", "rahma");
    assert.deepEqual(result, { error: "forbidden" });
    assert.equal(sent.length, 0, "and nothing was sent");
    assert.equal(updates.length, 0, "and nothing was written");
  });

  test("the refusal happens BEFORE the escalation is even read", async () => {
    // A gate that runs after the work is a gate that leaks whether the row
    // exists. Asking about a nonexistent id as a non-approver must not tell
    // them it does not exist.
    reset();
    const result = await queue.approveAndSend("no-such-id", "rahma");
    assert.deepEqual(result, { error: "forbidden" }, "not `not_found`");
  });

  test("Siham approves with equal authority, for an escalation outside her pair", async () => {
    // §5.3: the backup approver acts "with the same authority, for any
    // escalation". This one is routed to Rahma & Mohammed. A directorate check
    // anywhere in this path would break AC-11.2 while looking like tightening.
    reset();
    const result = await queue.approveAndSend("e1", "siham");
    assert.deepEqual(result, { ok: true, status: "SENT" });
  });

  test("an empty draft cannot be approved into a blank email", async () => {
    reset();
    rows.e1.draftAnswer = "   ";
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "no_draft" });
    assert.equal(sent.length, 0);
  });

  test("a CLOSED escalation cannot be approved and sent", async () => {
    // Found by running the RBAC matrix against the live app, not by reading the
    // code: the guard checked SENT alone, so after HR closed a thread an
    // approver could still send on it — mailing an employee about a conversation
    // whose reply link had just been revoked, with no way to answer.
    reset();
    rows.e1.status = "CLOSED";
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "closed" });
    assert.equal(sent.length, 0, "REGRESSION: a closed conversation still emails the employee");
    assert.equal(updates.length, 0);
  });

  test("an already-sent answer is not re-sent", async () => {
    reset();
    rows.e1.status = "SENT";
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "already_sent" });
    assert.equal(sent.length, 0);
  });
});

describe("AC-11.4 — a failed send is never recorded as sent", { skip: !canMock }, () => {
  test("a thrown transport error lands in SEND_FAILED", async () => {
    reset();
    sendBehaviour = "throw";
    const result = await queue.approveAndSend("e1", "muna");
    assert.equal((result as { status: string }).status, "SEND_FAILED");
    const statuses = updates.map((u) => u.status);
    assert.ok(!statuses.includes("SENT"), "REGRESSION: a failed send was marked SENT");
    assert.ok(statuses.includes("SEND_FAILED"));
  });

  test("an unconfigured mailer is a FAILURE, not a quiet success", async () => {
    // `sent: false` means nothing was written to a socket. Treating it as sent
    // leaves an employee waiting on an email that does not exist.
    reset();
    sendBehaviour = "unsent";
    const result = await queue.approveAndSend("e1", "muna");
    assert.equal((result as { status: string }).status, "SEND_FAILED");
    assert.match(String((result as { error: string }).error), /not configured/i);
  });

  test("the error is recorded on the row, so it reappears in the queue", async () => {
    reset();
    sendBehaviour = "throw";
    await queue.approveAndSend("e1", "muna");
    const failure = updates.find((u) => u.status === "SEND_FAILED")!;
    assert.match(String(failure.sendError), /550/);
  });

  test("the recorded error is truncated — a transport error can carry the body", async () => {
    // The body contains the employee's question, which is Confidential (§1).
    reset();
    sendBehaviour = "throw";
    await queue.approveAndSend("e1", "muna");
    const failure = updates.find((u) => u.status === "SEND_FAILED")!;
    assert.ok(String(failure.sendError).length <= 300);
  });

  test("APPROVED is written BEFORE the send, so the decision survives a failure", async () => {
    // The human decision stands whether or not the transport cooperates, and
    // that is what makes a SEND_FAILED row resumable rather than needing a
    // second approval.
    reset();
    sendBehaviour = "throw";
    await queue.approveAndSend("e1", "muna");
    assert.equal(updates[0].status, "APPROVED");
    assert.equal(updates[0].approvedById, "muna");
    assert.ok(updates[0].approvedAt instanceof Date);
  });

  test("SENT is written only AFTER the send succeeds", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    const order = updates.map((u) => u.status);
    assert.deepEqual(order, ["APPROVED", "SENT"]);
    assert.equal(sent.length, 1, "and the email actually went");
  });

  test("a successful send clears any earlier error and records the thread", async () => {
    reset();
    rows.e1.sendError = "an earlier failure";
    await queue.approveAndSend("e1", "muna");
    const done = updates.find((u) => u.status === "SENT")!;
    assert.equal(done.sendError, null, "a retry that works must not keep the old error");
    assert.equal(messages.length, 1, "the outbound message joins the thread for a later reply");
    assert.equal(messages[0].direction, "OUTBOUND");
  });
});

describe("§5.6 — the email wording is content, not code", { skip: !canMock }, () => {
  test("the stored template is used, not a hardcoded string", async () => {
    // "must be stored as editable template text… not hardcoded — so Alaa can
    // reword the subject, opening line, or sign-off later without a developer."
    reset();
    template = { subject: "Rihal HR replied", body: "Salam {{employeeName}} — {{answer}}" };
    await queue.approveAndSend("e1", "muna");
    assert.equal(sent[0].subject, "Rihal HR replied");
    assert.match(sent[0].text, /Salam Sara Al Balushi/);
    assert.match(sent[0].text, /up to 10 days/);
  });

  test("with no stored template it still sends, from the §5.6 default", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.match(sent[0].subject, /Answered/);
    assert.match(sent[0].text, /thanks for reaching out/);
  });

  test("AC-9.4: the answer text is in the body, not only a link", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.match(sent[0].text, /up to 10 days carry over automatically/);
    assert.match(sent[0].text, /Can I carry over 15 days\?/, "and their question, quoted back");
  });

  test("AC-9.4: the email carries a reply link, minted for THIS escalation", async () => {
    // ADR-070: "the approval email carries the full approved answer AND a
    // signed, expiring link that reopens that one escalation thread".
    reset();
    template = { subject: "s", body: "Answer: {{answer}}\nReply here: {{replyLink}}\nBye." };
    await queue.approveAndSend("e1", "muna");
    assert.deepEqual(mintedFor, ["e1"], "REGRESSION: no reply link is issued on approval");
    assert.match(sent[0].text, /Reply here: https:\/\/hive\.example\/reply\/TOKEN-e1/);
    assert.doesNotMatch(sent[0].text, /\{\{replyLink\}\}/, "the placeholder must be substituted");
  });

  test("the link is built from AUTH_URL, never a request header", () => {
    // A forwarded Host would poison the emailed link and hand a bearer token to
    // a Confidential thread over to whoever set the header — the same
    // reset-poisoning `forgot-password` guards against, with a bigger prize.
    const src = readFileSync(
      new URL("../../lib/hive/services/escalation-send.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /env\.AUTH_URL/);
    assert.doesNotMatch(
      src,
      /nextUrl|headers\.get/,
      "REGRESSION: the origin comes from the request",
    );
  });

  test("with no AUTH_URL the LINE is dropped, and the answer still sends", async () => {
    // There is no honest origin to build from, and a link to the wrong host is
    // worse than no link. §5.4 step 6 promises the ANSWER arrives; it does.
    reset();
    authUrl = null;
    template = { subject: "s", body: "Answer: {{answer}}\nReply here: {{replyLink}}\nBye." };
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { ok: true, status: "SENT" });
    assert.equal(mintedFor.length, 0, "no token is minted for a link that cannot be built");
    assert.doesNotMatch(sent[0].text, /\{\{replyLink\}\}/);
    assert.doesNotMatch(
      sent[0].text,
      /Reply here/,
      "a dangling 'Reply here:' is worse than nothing",
    );
    assert.match(sent[0].text, /Bye\./, "the rest of the template survives");
    assert.match(sent[0].text, /Yes — up to 10 days/, "AC-9.4: the ANSWER is still in the body");
  });

  test("a filled link is substituted in place", () => {
    const out = queue.renderTemplate(
      { subject: "s", body: "Reply here: {{replyLink}}" },
      {
        employeeName: "n",
        question: "q",
        answer: "a",
        hrPairName: "p",
        replyLink: "https://hive/reply/abc",
        ticketId: "HIVE-0043",
      },
    );
    assert.match(out.text, /Reply here: https:\/\/hive\/reply\/abc/);
  });
});

describe("AC-10.1 — the queue shows escalations, never transcripts", { skip: !canMock }, () => {
  test("no conversation is reachable from a queue row", async () => {
    // §5.1's anonymity is not undone by an HR screen: a conversation HIVE
    // answered alone stays between the employee and the bot.
    reset();
    const { data } = await queue.listEscalations();
    const json = JSON.stringify(data);
    assert.doesNotMatch(json, /sessionId/, "REGRESSION: the queue exposes the conversation");
    assert.doesNotMatch(json, /"messages"/);
  });

  test("it is company-wide — no per-pair filter", async () => {
    // §5.3 gives the five standard accounts one shared queue, not five private
    // ones. A `where` on the caller's pair would look like least privilege and
    // would contradict AC-10.1.
    reset();
    const { data } = await queue.listEscalations();
    assert.equal(data.length, 1);
  });

  test("the page is bounded and hands back a cursor", async () => {
    reset();
    for (let i = 0; i < 60; i += 1) rows[`x${i}`] = { ...rows.e1, id: `x${i}` };
    const { data, nextCursor } = await queue.listEscalations();
    assert.equal(data.length, 50);
    assert.ok(nextCursor, "an unbounded queue is a slow page the first busy week");
  });

  test("the bound is on the QUERY, not just the returned array", async () => {
    // Slicing in JS gives the same array length while the database still reads
    // every row — so asserting `data.length` alone passes on an unbounded
    // query. Mutation testing showed exactly that: deleting `take` changed
    // nothing observable.
    reset();
    await queue.listEscalations();
    assert.equal(
      typeof lastQuery?.take,
      "number",
      "REGRESSION: the queue query is unbounded — the slice only hides it",
    );
    assert.ok(lastQuery!.take! <= 51);
  });
});

describe("US-T6 — queue filters and live counts", { skip: !canMock }, () => {
  test("each filter narrows the query; none set is the whole company-wide queue", () => {
    assert.deepEqual(queue.queueWhere({}), {}, "AC-10.1: no filter, no hidden narrowing");
    assert.deepEqual(queue.queueWhere({ pairId: "p1" }), { hrPairId: "p1" });
    assert.deepEqual(queue.queueWhere({ source: "SIRAAJ" }), { source: "SIRAAJ" });
    const gte = new Date("2026-10-01T00:00:00+04:00");
    assert.deepEqual(queue.queueWhere({ gte }), { createdAt: { gte } });
  });

  test("QA D-03: a drafter/approver without See tickets reads only their pairs", () => {
    assert.deepEqual(queue.queueWhere({ pairIds: ["p1", "p2"] }), {
      hrPairId: { in: ["p1", "p2"] },
    });
    assert.deepEqual(queue.queueWhere({ pairIds: ["p1"], pairId: "p1" }), { hrPairId: "p1" });
    assert.deepEqual(
      queue.queueWhere({ pairIds: ["p1"], pairId: "p9" }),
      { hrPairId: { in: [] } },
      "a pair filter outside the reader's reach matches nothing, never everything",
    );
    const list = readFileSync("app/api/hive/escalations/route.ts", "utf8");
    assert.match(list, /ticketReach\(ctx\.session\.user\.id\)/);
    assert.match(list, /listEscalations\(\{ \.\.\.parsed\.data, pairIds[,} ]/);
    const one = readFileSync("app/api/hive/escalations/[id]/route.ts", "utf8");
    assert.match(one, /reach !== "all" && !reach\.includes\(row\.hrPair\.id\)/);
  });

  test("search finds a ticket by the number HR quote, under ANY prefix — old emails keep working", () => {
    for (const q of ["HIVE-0047", "hive-47", "47", "HR-0047", "rhl2-47"]) {
      const or = queue.queueWhere({ q }).OR as Record<string, unknown>[];
      assert.deepEqual(or[0], { ticketNumber: 47 }, q);
    }
  });

  test("search also matches name, email and question, case-insensitively", () => {
    const or = queue.queueWhere({ q: "leave" }).OR as Record<string, unknown>[];
    const text = { contains: "leave", mode: "insensitive" };
    assert.deepEqual(or, [{ employeeName: text }, { employeeEmail: text }, { question: text }]);
  });

  test("the chip counts use every filter EXCEPT the status, so each chip says what it would show", async () => {
    reset();
    const { counts } = await queue.listEscalations({ status: "SENT", pairId: "p1" });
    assert.deepEqual(lastCountWhere, { hrPairId: "p1" });
    assert.ok(
      Object.values(counts).some((n) => n > 0),
      "counts come back keyed by status",
    );
  });

  test("dates are Muscat days: 'to' includes the whole of its day", async () => {
    const { escalationQuerySchema } = await import(
      import.meta.resolve("../../lib/validations/hive/escalation-queue.ts")
    );
    const f = escalationQuerySchema.parse({ from: "2026-10-01", to: "2026-10-01" });
    assert.equal(f.gte.toISOString(), "2026-09-30T20:00:00.000Z");
    assert.equal(f.lt.toISOString(), "2026-10-01T20:00:00.000Z");
    assert.equal(escalationQuerySchema.safeParse({ from: "2026-02-30" }).success, false);
  });
});

describe("the queue's ORDER is stable enough to page through", { skip: !canMock }, () => {
  test("newest first", async () => {
    reset();
    assert.deepEqual(lastQuery, null);
    await queue.listEscalations();
    assert.equal(
      lastQuery!.orderBy?.[0]?.createdAt,
      "desc",
      "the oldest question first is a queue nobody works",
    );
  });

  test("a unique tiebreaker follows it, or cursor paging loses rows", async () => {
    // `createdAt` is not unique. Two escalations raised in the same millisecond
    // — an employee re-asking, a burst after an announcement — sort arbitrarily
    // between one query and the next, and a cursor boundary landing between
    // them skips one or repeats one. The skipped row is an unanswered question
    // that never appears again, and nothing anywhere reports it.
    reset();
    await queue.listEscalations();
    const keys = (lastQuery!.orderBy ?? []).flatMap((o) => Object.keys(o));
    assert.ok(
      keys.includes("id"),
      "REGRESSION: the queue orders on a non-unique column with no tiebreaker",
    );
  });
});

describe("§5.4 step 4 — drafting, and what it does to an approval", { skip: !canMock }, () => {
  test("a draft is saved against its author and moves the row to IN_PROGRESS", async () => {
    reset();
    rows.e1.status = "OPEN";
    const result = await queue.draftAnswer("e1", "Up to 10 days, yes.", "rahma");
    assert.deepEqual(result, { ok: true, status: "IN_PROGRESS" });
    assert.equal(updates[0].draftAnswer, "Up to 10 days, yes.");
    assert.equal(updates[0].draftedById, "rahma");
    assert.equal(updates[0].status, "IN_PROGRESS");
    assert.deepEqual(
      events.map((e) => e.kind),
      ["DRAFT_SAVED"],
    );
  });

  test("editing an answer clears the approval it no longer describes", async () => {
    // Reachable through AC-11.4's own recovery path: a send fails, the row
    // returns to the queue, HR rewrites the answer. Leaving `approvedAt` set
    // would leave the record asserting Muna approved THIS text when she
    // approved different text — and AC-11.1 requires approval of every answer.
    reset();
    rows.e1.status = "SEND_FAILED";
    rows.e1.approvedById = "muna";
    rows.e1.approvedAt = new Date("2026-08-01");
    rows.e1.sendError = "smtp timeout";

    await queue.draftAnswer("e1", "Corrected: up to 10 days.", "rahma");
    const write = updates[0];
    assert.equal(write.approvedById, null, "REGRESSION: a stale approval survives a rewrite");
    assert.equal(write.approvedAt, null);
    assert.equal(write.sendError, null, "the old failure is not the new draft's failure");
  });

  test("a CLOSED thread cannot be drafted into", async () => {
    // Closing revoked the employee's reply link (ADR-070 clause 4), so writing a
    // new answer into it is a one-way message dressed as a thread.
    reset();
    rows.e1.status = "CLOSED";
    const result = await queue.draftAnswer("e1", "one more thought", "rahma");
    assert.deepEqual(result, { error: "closed" });
    assert.equal(updates.length, 0);
  });

  test("a SENT answer cannot be rewritten", async () => {
    // An employee has already read it. Editing the record afterwards makes the
    // trail describe an email nobody received.
    reset();
    rows.e1.status = "SENT";
    const result = await queue.draftAnswer("e1", "actually, no", "rahma");
    assert.deepEqual(result, { error: "already_sent" });
    assert.equal(updates.length, 0);
  });

  test("an escalation that does not exist is not_found, not a create", async () => {
    reset();
    const result = await queue.draftAnswer("nope", "hi", "rahma");
    assert.deepEqual(result, { error: "not_found" });
    assert.equal(updates.length, 0);
  });

  test("drafting confers no authority to send", async () => {
    // §5.4 step 5: approval is required "regardless of who drafted it". Rahma
    // holds draftEscalation and not approve; writing the answer must not
    // promote her.
    reset();
    await queue.draftAnswer("e1", "Up to 10 days.", "rahma");
    const result = await queue.approveAndSend("e1", "rahma");
    assert.deepEqual(result, { error: "forbidden" });
    assert.equal(sent.length, 0);
  });
});

describe("spec V2 §5.4 — the ticket lifecycle (blueprint T1)", { skip: !canMock }, () => {
  test("an answer still IN_PROGRESS cannot be approved — it must be submitted first", async () => {
    // Submit is the drafter's statement that THIS text is ready. Approving a
    // draft nobody submitted would send work in progress.
    reset();
    rows.e1.status = "IN_PROGRESS";
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "not_pending" });
    assert.equal(sent.length, 0);
    assert.equal(updates.length, 0);
  });

  test("submit moves IN_PROGRESS → PENDING_APPROVAL, recording who and when", async () => {
    reset();
    rows.e1.status = "IN_PROGRESS";
    const result = await queue.submitForApproval("e1", "rahma");
    assert.deepEqual(result, { ok: true, status: "PENDING_APPROVAL" });
    assert.equal(updates[0].submittedById, "rahma");
    assert.ok(updates[0].submittedAt instanceof Date);
    assert.deepEqual(events.at(-1), {
      escalationId: "e1",
      kind: "SUBMITTED",
      actorId: "rahma",
      note: null,
    });
  });

  test("submit refuses an empty draft, and a ticket not in progress", async () => {
    reset();
    rows.e1.status = "IN_PROGRESS";
    rows.e1.draftAnswer = null;
    assert.deepEqual(await queue.submitForApproval("e1", "rahma"), { error: "no_draft" });
    reset();
    rows.e1.status = "SENT";
    assert.deepEqual(await queue.submitForApproval("e1", "rahma"), { error: "not_in_progress" });
    assert.equal(updates.length, 0);
  });

  test("editing a submitted draft withdraws it from approval", async () => {
    // Approval is for a specific text. A pending submission of different words
    // must not survive the edit, or the approver approves what they never saw.
    reset();
    rows.e1.submittedById = "rahma";
    rows.e1.submittedAt = new Date();
    await queue.draftAnswer("e1", "A different answer.", "afra");
    assert.equal(rows.e1.status, "IN_PROGRESS");
    assert.equal(rows.e1.submittedById, null);
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "not_pending" });
  });

  test("an approver can return a submission with a note; a drafter cannot", async () => {
    reset();
    assert.deepEqual(await queue.returnToDraft("e1", "rahma", "no"), { error: "forbidden" });
    const result = await queue.returnToDraft("e1", "muna", "Mention the 31 March cut-off.");
    assert.deepEqual(result, { ok: true, status: "IN_PROGRESS" });
    assert.equal(rows.e1.status, "IN_PROGRESS");
    assert.equal(rows.e1.draftAnswer, "Yes — up to 10 days carry over automatically.", "kept");
    assert.deepEqual(events.at(-1), {
      escalationId: "e1",
      kind: "RETURNED",
      actorId: "muna",
      note: "Mention the 31 March cut-off.",
    });
  });

  test("return refuses a ticket that is not waiting for approval", async () => {
    reset();
    rows.e1.status = "SENT";
    assert.deepEqual(await queue.returnToDraft("e1", "muna"), { error: "not_pending" });
    assert.deepEqual(await queue.returnToDraft("nope", "muna"), { error: "not_found" });
  });

  test("approve → send writes APPROVED then SENT history, in that order", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.deepEqual(
      events.map((e) => [e.kind, e.actorId]),
      [
        ["APPROVED", "muna"],
        ["SENT", "muna"],
      ],
    );
  });

  test("a failed send is history too", async () => {
    reset();
    sendBehaviour = "throw";
    await queue.approveAndSend("e1", "muna");
    assert.deepEqual(
      events.map((e) => e.kind),
      ["APPROVED", "SEND_FAILED"],
    );
  });

  test("retry from SEND_FAILED keeps the ORIGINAL approval and needs no second one", async () => {
    // The human decision stood; only the transport failed. The retry must not
    // overwrite who approved it with who pressed retry.
    reset();
    rows.e1.status = "SEND_FAILED";
    rows.e1.approvedById = "muna";
    const approvedAt = new Date("2026-10-01");
    rows.e1.approvedAt = approvedAt;
    const result = await queue.approveAndSend("e1", "siham");
    assert.deepEqual(result, { ok: true, status: "SENT" });
    assert.equal(rows.e1.approvedById, "muna");
    assert.equal(rows.e1.approvedAt, approvedAt);
    assert.ok(!events.some((e) => e.kind === "APPROVED"), "a retry is not a second approval");
  });

  test("a ticket already being sent (APPROVED) is not claimed twice", async () => {
    // Blueprint W4: two approvers press at once. The second sees the claim.
    reset();
    rows.e1.status = "APPROVED";
    const result = await queue.approveAndSend("e1", "siham");
    assert.deepEqual(result, { error: "sending" });
    assert.equal(sent.length, 0);
  });

  test("AC-T1.4: the email subject carries the ticket ID", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.equal(sent[0].subject, "Your question to HIVE — Answered (Ticket HIVE-0043)");
  });

  test("§8.8 Settings: the email quotes the prefix HR set, not a hardcoded one", async () => {
    reset();
    ticketPrefix = "HR";
    await queue.approveAndSend("e1", "muna");
    assert.match(sent[0].subject, /\(Ticket HR-0043\)/);
  });

  test("a drafter may close a SENT ticket, but nothing earlier", async () => {
    // Spec V2 §8.8: "Anyone who can draft sees Close ticket on a Sent ticket."
    reset();
    approvers = new Set();
    assert.deepEqual(await queue.closeEscalation("e1", "rahma"), { error: "forbidden" });
    rows.e1.status = "SENT";
    const result = await queue.closeEscalation("e1", "rahma");
    assert.ok("ok" in result);
    assert.equal(rows.e1.status, "CLOSED");
    assert.equal(events.at(-1)?.kind, "CLOSED");
    assert.deepEqual(await queue.closeEscalation("e1", "rahma"), { error: "already_closed" });
  });

  test("a ticket stuck mid-send (stale APPROVED claim) can be re-sent, keeping its approver", async () => {
    // Reviewer finding 1: a send that died between claim and settle left the
    // ticket refusing everything but Close, forever.
    reset();
    rows.e1.status = "APPROVED";
    rows.e1.approvedById = "muna";
    rows.e1.updatedAt = new Date(Date.now() - 11 * 60 * 1000);
    const result = await queue.approveAndSend("e1", "siham");
    assert.deepEqual(result, { ok: true, status: "SENT" });
    assert.equal(rows.e1.approvedById, "muna");
    assert.ok(!events.some((e) => e.kind === "APPROVED"));
  });

  test("a FRESH claim is not taken over — that send is still in flight", async () => {
    reset();
    rows.e1.status = "APPROVED";
    rows.e1.updatedAt = new Date();
    assert.deepEqual(await queue.approveAndSend("e1", "siham"), { error: "sending" });
    assert.equal(sent.length, 0);
  });

  test("Close refuses a ticket mid-send", async () => {
    // Reviewer finding 2: closing mid-send revoked links before the send
    // minted one, then the send flipped CLOSED back to SENT.
    reset();
    rows.e1.status = "APPROVED";
    assert.deepEqual(await queue.closeEscalation("e1", "muna"), { error: "sending" });
    assert.equal(rows.e1.status, "APPROVED");
  });

  test("an employee reply that lands during the send reopens the ticket after it", async () => {
    // Reviewer finding 3: the reply could not reopen a sending ticket, and
    // nothing picked it up afterwards.
    reset();
    duringSend = () =>
      messages.push({ escalationId: "e1", direction: "INBOUND", body: "and?", at: new Date() });
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { ok: true, status: "SENT" });
    assert.equal(rows.e1.status, "IN_PROGRESS");
    assert.deepEqual(
      events.map((e) => e.kind),
      ["APPROVED", "SENT", "REOPENED"],
    );
  });

  test("no late reply, no reopen", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.equal(rows.e1.status, "SENT");
  });

  test("a reopened ticket cannot be re-submitted with the answer already sent", async () => {
    // Reviewer finding 4: submit-then-approve unedited would mail the same
    // email again.
    reset();
    rows.e1.status = "IN_PROGRESS";
    messages.push({
      escalationId: "e1",
      direction: "OUTBOUND",
      body: rows.e1.draftAnswer,
      at: new Date(),
    });
    assert.deepEqual(await queue.submitForApproval("e1", "rahma"), { error: "unchanged" });
    rows.e1.draftAnswer = "Following up: yes, and the cut-off is 31 March.";
    assert.deepEqual(await queue.submitForApproval("e1", "rahma"), {
      ok: true,
      status: "PENDING_APPROVAL",
    });
  });
});

describe("ADR-073 — actions are scoped to the ticket's HR pair", { skip: !canMock }, () => {
  test("an own-pair approver cannot approve another pair's ticket", async () => {
    reset();
    ownPair = { siham: "pair-siham" };
    assert.deepEqual(await queue.approveAndSend("e1", "siham"), { error: "forbidden" });
    assert.equal(sent.length, 0);
  });

  test("…and can approve their own pair's", async () => {
    reset();
    ownPair = { siham: "pair-rahma" };
    assert.deepEqual(await queue.approveAndSend("e1", "siham"), { ok: true, status: "SENT" });
  });

  test("an own-pair drafter cannot draft, submit or close on another pair", async () => {
    reset();
    ownPair = { afra: "pair-shahed" };
    assert.deepEqual(await queue.draftAnswer("e1", "x", "afra"), { error: "forbidden" });
    rows.e1.status = "IN_PROGRESS";
    assert.deepEqual(await queue.submitForApproval("e1", "afra"), { error: "forbidden" });
    rows.e1.status = "SENT";
    assert.deepEqual(await queue.closeEscalation("e1", "afra"), { error: "forbidden" });
    assert.equal(updates.length, 0);
  });

  test("returning is an approver's act on that pair", async () => {
    reset();
    ownPair = { siham: "pair-siham" };
    assert.deepEqual(await queue.returnToDraft("e1", "siham", "no"), { error: "forbidden" });
  });
});

describe("Amendment B-3 — no self-approval", { skip: !canMock }, () => {
  test("the person who wrote the draft cannot approve it, whatever their scope", async () => {
    reset();
    rows.e1.draftedById = "muna";
    const result = await queue.approveAndSend("e1", "muna");
    assert.deepEqual(result, { error: "self_approval" });
    assert.equal(sent.length, 0);
    assert.equal(updates.length, 0, "and nothing was claimed");
  });

  test("another approver can", async () => {
    reset();
    rows.e1.draftedById = "muna";
    assert.deepEqual(await queue.approveAndSend("e1", "siham"), { ok: true, status: "SENT" });
  });

  test("a retry of a failed send is not a second approval, so the drafter may press it", async () => {
    reset();
    rows.e1.status = "SEND_FAILED";
    rows.e1.draftedById = "muna";
    rows.e1.approvedById = "siham";
    assert.deepEqual(await queue.approveAndSend("e1", "muna"), { ok: true, status: "SENT" });
    assert.equal(rows.e1.approvedById, "siham", "the approval stays Siham's");
  });

  test("ticketAbilities tells the screen, so it can say 'waiting for another approver'", async () => {
    reset();
    const mine = await queue.ticketAbilities("muna", {
      hrPairId: "pair-rahma",
      draftedById: "muna",
    });
    assert.deepEqual(mine, { draft: true, approve: true, ownDraft: true });
  });
});

describe("US-T5 — the hand-offs ask for their notification", { skip: !canMock }, () => {
  test("submitting notifies approvers; a refused submit does not", async () => {
    reset();
    rows.e1.status = "IN_PROGRESS";
    await queue.submitForApproval("e1", "rahma");
    assert.deepEqual(notified, ["submitted:e1"]);
    notified = [];
    await queue.submitForApproval("e1", "rahma");
    assert.deepEqual(notified, [], "already pending: nothing new to tell anyone");
  });

  test("a successful send notifies the drafter; a failed send does not", async () => {
    reset();
    await queue.approveAndSend("e1", "muna");
    assert.deepEqual(notified, ["sent:e1"]);
    reset();
    sendBehaviour = "throw";
    await queue.approveAndSend("e1", "muna");
    assert.deepEqual(notified, []);
  });
});
