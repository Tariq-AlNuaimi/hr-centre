import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// US-T5 (spec V2 §8.9): who hears about a ticket, and what the email may say.
// The failure modes worth pinning are leaks and silence — the question body in
// full (W8), the employee's identity, the drafter asked to approve their own
// draft (B-3), or a send failure turning into a failed transition.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** The ticket prefix the settings double returns (default, or a test's rename). */
let ticketPrefix = "HIVE";

let sent: { to: string[]; subject: string; text: string }[] = [];
let sendThrows = false;
let ticket: Record<string, unknown> | null = null;
/** Role-builder assignments, as `usersHoldingPermission` would see them. */
let assignments: { userId: string; permission: string; type: string; id: string | null }[] = [];
let pairTicketsLastHour = 1;

type Notify = typeof import("../../lib/hive/services/ticket-notify.ts");
let notify: Notify;

const QUESTION = "Can I carry over my annual leave? " + "Lorem ipsum dolor sit amet ".repeat(30);

function reset() {
  ticketPrefix = "HIVE";
  sent = [];
  sendThrows = false;
  assignments = [
    { userId: "u-rahma", permission: "tickets.draft", type: "OWN_HR_PAIR", id: null },
    { userId: "u-rahma", permission: "tickets.approve", type: "OWN_HR_PAIR", id: null },
    { userId: "u-mohammed", permission: "tickets.draft", type: "OWN_HR_PAIR", id: null },
    // Muna: every pair. Drafts everywhere, so NOT told about "opened" (HIVE quirk).
    { userId: "u-muna", permission: "tickets.draft", type: "GROUP", id: null },
    { userId: "u-muna", permission: "tickets.approve", type: "GROUP", id: null },
    // Cover for this pair (time-boxed HR_PAIR assignment).
    { userId: "u-cover", permission: "tickets.draft", type: "HR_PAIR", id: "pair-rahma" },
    // Own-pair holders of ANOTHER pair are never told.
    { userId: "u-shahed", permission: "tickets.draft", type: "OWN_HR_PAIR", id: null },
    { userId: "u-shahed", permission: "tickets.approve", type: "OWN_HR_PAIR", id: null },
  ];
  pairTicketsLastHour = 1;
  ticket = {
    id: "e1",
    ticketNumber: 47,
    question: QUESTION,
    hrPairId: "pair-rahma",
    draftedById: "u-rahma",
    hrPair: { name: "Rahma Adam & Mohammed Al Amri" },
    draftedBy: { email: "Rahma.Adam@rihal.om", deletedAt: null },
  };
}

before(async () => {
  if (!canMock) return;
  // Outside a request `after()` throws; the notifier must still deliver.
  mockApi.module!("next/server", {
    namedExports: {
      after: () => {
        throw new Error("after() was called outside a request scope");
      },
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/env.ts"), {
    namedExports: { env: { AUTH_URL: "https://hive.example" } },
  });
  mockApi.module!(import.meta.resolve("../../lib/email.ts"), {
    namedExports: {
      sendEmail: async (o: { to: string[]; subject: string; text: string }) => {
        if (sendThrows) throw new Error("smtp down: rahma.adam@rihal.om");
        sent.push(o);
        return { sent: true };
      },
    },
  });
  const { scopeCovers } = await import(import.meta.resolve("../../lib/rbac/grants.ts"));
  mockApi.module!(import.meta.resolve("../../lib/rbac/resolve.ts"), {
    namedExports: {
      usersHoldingPermission: async (permission: string, subject: Record<string, unknown>) => [
        ...new Set(
          assignments
            .filter((a) => a.permission === permission)
            .filter((a) => scopeCovers({ type: a.type, id: a.id }, subject))
            .map((a) => a.userId),
        ),
      ],
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
      prisma: {
        escalation: {
          findUnique: async () => ticket,
          count: async () => pairTicketsLastHour,
        },
        hrTagMember: {
          findMany: async ({ where }: { where: { pairId: string } }) =>
            where.pairId === "pair-rahma"
              ? [{ userId: "u-rahma" }, { userId: "u-mohammed" }]
              : [{ userId: "u-shahed" }],
        },
        user: {
          findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.map((id) => ({
              email: {
                "u-rahma": "Rahma.Adam@rihal.om",
                "u-mohammed": "Mohammed.Amri@rihal.om",
                "u-muna": "Muna.Adam@rihal.om",
                "u-cover": "siham.hadhrami@rihal.om",
                "u-shahed": "shahed.amri@rihal.om",
              }[id],
            })),
        },
      },
    },
  });
  notify = (await import(
    import.meta.resolve("../../lib/hive/services/ticket-notify.ts")
  )) as Notify;
});

/** `notifyTicket` is fire-and-forget; give the background send a tick. */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("US-T5 — who is told", { skip: !canMock }, () => {
  test("opened → whoever can draft for the pair (own pair or cover), not group drafters", async () => {
    reset();
    notify.notifyTicket("opened", "e1");
    await settle();
    assert.deepEqual(
      [...(sent[0]?.to ?? [])].sort(),
      ["mohammed.amri@rihal.om", "rahma.adam@rihal.om", "siham.hadhrami@rihal.om"],
      "own-pair members + the cover holder; not Muna (group), not Shahed (other pair)",
    );
    assert.match(sent[0]!.subject, /New HR ticket HIVE-0047/);
  });

  test("reopened → the pair's drafters and the drafter, once each", async () => {
    reset();
    notify.notifyTicket("reopened", "e1");
    await settle();
    assert.deepEqual(
      [...(sent[0]?.to ?? [])].sort(),
      ["mohammed.amri@rihal.om", "rahma.adam@rihal.om", "siham.hadhrami@rihal.om"],
      "the drafter (Rahma) is already a pair drafter: told once",
    );
    assert.match(sent[0]!.subject, /HIVE-0047 reopened/);
  });

  test("§8.8 Settings: the notification quotes the prefix HR set", async () => {
    reset();
    ticketPrefix = "HR";
    notify.notifyTicket("opened", "e1");
    await settle();
    assert.match(sent[0]!.subject, /New HR ticket HR-0047/);
  });

  test("a pair over its hourly share gets no more pair-wide emails (flood backstop)", async () => {
    reset();
    pairTicketsLastHour = 21;
    notify.notifyTicket("opened", "e1");
    notify.notifyTicket("submitted", "e1");
    await settle();
    assert.equal(sent.length, 1, "only the approvers' email — it is not pair-wide");
    assert.match(sent[0]!.subject, /waiting for your approval/);
  });

  test("submitted → approvers covering the pair, never the drafter, each once", async () => {
    reset();
    notify.notifyTicket("submitted", "e1");
    await settle();
    assert.deepEqual(
      sent[0]?.to,
      ["muna.adam@rihal.om"],
      "B-3: Rahma (own-pair approver) drafted it, so only Muna; Shahed's pair is another",
    );
  });

  test("sent → the drafter; a deleted drafter is told nothing", async () => {
    reset();
    notify.notifyTicket("sent", "e1");
    await settle();
    assert.deepEqual(sent[0]?.to, ["rahma.adam@rihal.om"]);
    reset();
    (ticket!.draftedBy as { deletedAt: Date | null }).deletedAt = new Date();
    notify.notifyTicket("sent", "e1");
    await settle();
    assert.equal(sent.length, 0);
  });
});

describe("US-T5 — what the email may say", { skip: !canMock }, () => {
  test("W8: at most the first 200 characters of the question", async () => {
    reset();
    notify.notifyTicket("opened", "e1");
    await settle();
    const line = sent[0]!.text.split("\n").find((l) => l.startsWith("Question: "))!;
    assert.ok(line.length - "Question: ".length <= 201, "200 characters plus the ellipsis");
    assert.ok(line.endsWith("…"));
    assert.ok(!sent[0]!.text.includes(QUESTION), "never the whole question");
  });

  test("it links to the ticket in HR Centre", async () => {
    reset();
    notify.notifyTicket("opened", "e1");
    await settle();
    assert.match(sent[0]!.text, /https:\/\/hive\.example\/en\/tickets\/e1/);
  });

  test("a short question is passed whole and untouched", () => {
    assert.equal(notify.preview("  Can I   work from home?  "), "Can I work from home?");
  });
});

describe("US-T5 — never on the critical path", { skip: !canMock }, () => {
  test("a failed send is swallowed, not thrown at the transition", async () => {
    reset();
    sendThrows = true;
    assert.doesNotThrow(() => notify.notifyTicket("opened", "e1"));
    await settle();
    assert.equal(sent.length, 0);
  });

  test("a ticket that no longer exists sends nothing", async () => {
    reset();
    ticket = null;
    notify.notifyTicket("opened", "e1");
    await settle();
    assert.equal(sent.length, 0);
  });
});
