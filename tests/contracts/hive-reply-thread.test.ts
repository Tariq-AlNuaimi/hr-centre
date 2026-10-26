import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// ADR-070's thread, read and written through a reply link (AC-9.5, AC-9.6).
//
// AC-9.5: a follow-up "SHALL append it to the same escalation, route it to the
// same HR pair, and SHALL NOT create a new escalation."
// AC-9.6: the link "SHALL NOT grant the topic menu as that person, SHALL NOT
// reach any other escalation, and SHALL NOT restore general chat history."
//
// ADR-070's Mitigations narrow the write further: "the write path from a reply
// link appends an `EscalationMessage` and nothing else — it cannot alter the
// original question, the approved answer, or any status" beyond putting the
// thread back in front of HR.
//
// Every one of those is an ABSENCE, which is the hardest kind of requirement to
// keep: nothing about `question` or `hrPairId` appearing in an update would look
// wrong in review, and the employee whose approved answer was overwritten by a
// link they forwarded would be the one to find out.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** Notifications asked for (US-T5). */
let notified: string[] = [];

type Reply = typeof import("../../lib/hive/services/reply.ts");
let reply: Reply;

let row: Record<string, unknown> | null = null;
let messages: Record<string, unknown>[] = [];
let updates: Record<string, unknown>[] = [];
let events: Record<string, unknown>[] = [];
let created: Record<string, unknown>[] = [];
let audits: Record<string, unknown>[] = [];
let lastSelect: Record<string, unknown> | null = null;

function reset() {
  row = {
    id: "e1",
    status: "SENT",
    // Present on purpose: AC-9.6's "no chat history" check needs something that
    // COULD leak, or it passes vacuously.
    sessionId: "sess-secret",
    employeeName: "Sara Al Balushi",
    employeeEmail: "sara.balushi@rihal.om",
    question: "Can I carry over 15 days?",
    draftAnswer: "Up to 10 days carry over automatically.",
    hrPairId: "pair-1",
    createdAt: new Date("2026-08-20T08:00:00Z"),
    hrPair: { name: "Rahma Adam & Mohammed Al Amri" },
    messages: [],
  };
  messages = [];
  updates = [];
  notified = [];
  events = [];
  created = [];
  audits = [];
  lastSelect = null;
}

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma/audit-extension.ts"), {
    namedExports: {
      recordAudit: async (_c: unknown, entry: Record<string, unknown>) => {
        audits.push(entry);
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hand-rolled Prisma double
  const prismaMock: any = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    escalationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return { id: `ev-${events.length}` };
      },
    },
    escalation: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => {
        lastSelect = select;
        if (!row || row.id !== where.id) return null;
        // Projected through `select`, so a read that quietly starts asking
        // for `sessionId` shows up here instead of passing on a mock that
        // returns everything.
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) out[key] = row[key];
        return out;
      },
      // Conditional like Prisma's: the status filter must hold, or P2025.
      update: async ({
        where,
        data,
      }: {
        where: { id: string; status?: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        if (
          !row ||
          row.id !== where.id ||
          (where.status && !where.status.in.includes(String(row.status)))
        ) {
          throw Object.assign(new Error("No record found"), { code: "P2025" });
        }
        updates.push({ id: where.id, ...data });
        Object.assign(row, data);
        return { id: where.id };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      },
    },
    escalationMessage: {
      count: async ({ where }: { where: { direction: string } }) =>
        messages.filter((m) => m.direction === where.direction).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messages.push(data);
        return data;
      },
    },
  };
  // US-T5: captured, not sent — tests/contracts/hive-ticket-notify.test.ts covers delivery.
  mockApi.module!(import.meta.resolve("../../lib/hive/services/ticket-notify.ts"), {
    namedExports: {
      notifyTicket: (kind: string, id: string) => notified.push(`${kind}:${id}`),
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: prismaMock,
      auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) => prismaMock.$transaction(fn),
    },
  });
  reply = (await import(import.meta.resolve("../../lib/hive/services/reply.ts"))) as Reply;
});

describe("AC-9.6 — the link shows ONE thread and nothing around it", { skip: !canMock }, () => {
  test("the conversation on the device is not reachable from here", async () => {
    // §3.7 keeps chat history on the employee's own device and out of any
    // server-rendered view. A link that restored it would undo that quietly.
    reset();
    const thread = await reply.loadReplyThread("e1");
    const json = JSON.stringify(thread);
    assert.doesNotMatch(json, /sessionId/, "REGRESSION: the link exposes the conversation");
    assert.doesNotMatch(json, /sess-secret/);
  });

  test("the employee's email is not echoed back into the page", async () => {
    // They already know it; putting it in a server-rendered page behind a
    // forwardable link puts it somewhere it did not have to be.
    reset();
    const thread = await reply.loadReplyThread("e1");
    assert.doesNotMatch(JSON.stringify(thread), /sara\.balushi@rihal\.om/);
  });

  test("no drafter or approver is disclosed — only the HR PAIR", async () => {
    // §6.6 frames HR as a pair the employee already knows. Which individual
    // typed it, and which manager signed it off, is internal.
    reset();
    const thread = await reply.loadReplyThread("e1");
    assert.equal(thread!.hrPairName, "Rahma Adam & Mohammed Al Amri");
    assert.doesNotMatch(JSON.stringify(thread), /draftedBy|approvedBy|approvedAt/);
  });

  test("the returned shape is CLOSED — an added select field cannot ride along", async () => {
    // Asserted on the keys rather than on absent values: widening the `select`
    // is harmless while the return is built field by field, and dangerous the
    // moment someone spreads the row instead. This is the assertion that
    // notices the spread.
    reset();
    const thread = await reply.loadReplyThread("e1");
    assert.deepEqual(Object.keys(thread!).sort(), [
      "answer",
      "closed",
      "createdAt",
      "employeeName",
      "hrPairName",
      "id",
      "messages",
      "question",
    ]);
  });

  test("a thread that does not exist is null, not an empty shell", async () => {
    reset();
    assert.equal(await reply.loadReplyThread("nope"), null);
  });

  test("the messages read is BOUNDED and ordered with a tiebreaker", async () => {
    // An unbounded relation read on a public route is how a thread becomes a
    // payload; `at` is not unique, so without `id` two messages written in the
    // same millisecond render in an arbitrary order — a question shown after its
    // answer reads as a different conversation.
    reset();
    await reply.loadReplyThread("e1");
    const msgs = lastSelect!.messages as { take?: number; orderBy?: { [k: string]: string }[] };
    assert.equal(typeof msgs.take, "number", "REGRESSION: the thread read is unbounded");
    assert.equal(msgs.orderBy?.[0]?.at, "asc");
    assert.ok(
      (msgs.orderBy ?? []).flatMap((o) => Object.keys(o)).includes("id"),
      "REGRESSION: messages order on a non-unique column with no tiebreaker",
    );
  });
});

describe("the answer appears only once it has been SENT", { skip: !canMock }, () => {
  test("a sent answer is shown", async () => {
    reset();
    const thread = await reply.loadReplyThread("e1");
    assert.equal(thread!.answer, "Up to 10 days carry over automatically.");
  });

  test("a PENDING_APPROVAL answer is NOT — that would leak it past the approval gate", async () => {
    // §5.4 step 5 requires approval of every answer before it reaches anyone. A
    // link that rendered HR's working text would be a second, ungated channel to
    // exactly the thing the gate exists to hold back.
    reset();
    row!.status = "PENDING_APPROVAL";
    const thread = await reply.loadReplyThread("e1");
    assert.equal(thread!.answer, null, "REGRESSION: an unapproved answer is visible");
    assert.doesNotMatch(JSON.stringify(thread), /carry over automatically/);
  });

  test("a SEND_FAILED answer is not shown either", async () => {
    reset();
    row!.status = "SEND_FAILED";
    assert.equal((await reply.loadReplyThread("e1"))!.answer, null);
  });
});

describe("AC-9.5 — a follow-up continues, never restarts", { skip: !canMock }, () => {
  test("it appends a message and creates NO new escalation", async () => {
    reset();
    const result = await reply.appendReply("e1", "What about unused days from last year?");
    assert.deepEqual(result, { ok: true, status: "IN_PROGRESS" });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].direction, "INBOUND");
    assert.equal(messages[0].escalationId, "e1");
    assert.equal(created.length, 0, "REGRESSION: a follow-up started a fresh escalation");
  });

  test("the HR pair is never rewritten, so routing is unchanged", async () => {
    // "routes back to the same HR pair automatically" — which, once the
    // escalation already carries one, means NOT touching it.
    reset();
    await reply.appendReply("e1", "follow-up");
    assert.ok(!("hrPairId" in updates[0]), "REGRESSION: a reply link can re-route the escalation");
    assert.equal(row!.hrPairId, "pair-1");
  });

  test("the question and the approved answer are untouchable from a link", async () => {
    // ADR-070's Mitigations. Anyone the employee forwards the email to holds
    // this token; the write it permits must not be able to rewrite the record.
    reset();
    await reply.appendReply("e1", "follow-up");
    for (const field of [
      "question",
      "draftAnswer",
      "employeeName",
      "employeeEmail",
      "approvedById",
    ]) {
      assert.ok(!(field in updates[0]), `REGRESSION: a reply link can write ${field}`);
    }
    assert.equal(row!.question, "Can I carry over 15 days?");
    assert.equal(row!.draftAnswer, "Up to 10 days carry over automatically.");
  });

  test("the only status it may set is IN_PROGRESS — back into the queue", async () => {
    // Otherwise a follow-up is lost behind a SENT status nobody looks at again.
    // Spec V2 §8.8: the same ticket reopens as In Progress, and a pending
    // submission is withdrawn — it answered a thread that has since moved on.
    reset();
    await reply.appendReply("e1", "follow-up");
    assert.deepEqual(Object.keys(updates[0]).sort(), [
      "id",
      "status",
      "submittedAt",
      "submittedById",
    ]);
    assert.equal(updates[0].status, "IN_PROGRESS");
    assert.equal(updates[0].submittedById, null);
    assert.deepEqual(events, [{ escalationId: "e1", kind: "REOPENED", actorId: null }]);
  });

  test("US-T5: a reopen tells the pair and the drafter", async () => {
    reset();
    await reply.appendReply("e1", "follow-up");
    assert.deepEqual(notified, ["reopened:e1"]);
  });

  test("a ticket mid-send keeps its status, and no reopen is recorded", async () => {
    // APPROVED is the seconds-long sending claim. Reopening it would race the
    // send; the message is kept and HR see it once the send settles.
    reset();
    row!.status = "APPROVED";
    const result = await reply.appendReply("e1", "follow-up");
    assert.ok("ok" in result);
    assert.equal(messages.length, 1, "the message is still recorded");
    assert.equal(updates.length, 0);
    assert.equal(events.length, 0);
    assert.deepEqual(notified, [], "nothing reopened, nothing to announce");
  });

  test("a CLOSED thread stays closed", async () => {
    // HR decided it was finished. A link that could reopen it indefinitely
    // would make CLOSED mean nothing.
    reset();
    row!.status = "CLOSED";
    assert.deepEqual(await reply.appendReply("e1", "one more thing"), { error: "closed" });
    assert.equal(messages.length, 0);
    assert.equal(updates.length, 0);
  });

  test("a thread that does not exist is not_found, not a create", async () => {
    reset();
    assert.deepEqual(await reply.appendReply("nope", "hi"), { error: "not_found" });
    assert.equal(created.length, 0);
  });

  test("follow-ups are bounded per THREAD, not just per minute", async () => {
    // The rate limit stops a flood; this stops a slow one. Without it a link is
    // an unbounded write into a Confidential record HR are obliged to read.
    reset();
    for (let i = 0; i < 5; i += 1) {
      assert.ok("ok" in (await reply.appendReply("e1", `follow-up ${i}`)));
    }
    assert.deepEqual(await reply.appendReply("e1", "one too many"), { error: "too_many" });
    assert.equal(messages.length, 5, "REGRESSION: a link can write into a thread without limit");
  });

  test("HR's own outbound messages do not count against that bound", async () => {
    // Otherwise a long, healthy exchange locks the employee out of it.
    reset();
    for (let i = 0; i < 4; i += 1) messages.push({ direction: "OUTBOUND", body: `hr ${i}` });
    assert.ok("ok" in (await reply.appendReply("e1", "follow-up")));
  });

  test("the follow-up is audited as arriving via a LINK, with no body in the row", async () => {
    // The actor is a bearer token rather than a person: the audit row is the
    // only place that fact is written down. The message text is Confidential and
    // already stored once, in the row this refers to.
    reset();
    await reply.appendReply("e1", "my leave balance is wrong");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entityId, "e1");
    assert.doesNotMatch(
      JSON.stringify(audits[0]),
      /leave balance is wrong/,
      "REGRESSION: Confidential text is duplicated into the audit log",
    );
    assert.match(JSON.stringify(audits[0]), /reply-link/);
  });
});
