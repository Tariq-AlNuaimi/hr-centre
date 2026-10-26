import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// §5.6's admin-editable email text (US11, task 5.3).
//
// §5.6 is a no-developer requirement: "the subject line and body wording above
// are the default, but must be stored as editable template text in the admin
// panel… so Alaa can reword the subject, opening line, or sign-off later without
// a developer."
//
// The one rule with teeth is that a saved body must still contain `{{answer}}`.
// §5.6 makes the approved answer "the only variable part", and a body that has
// lost it — most likely deleted while rewording the opening line — still
// renders, still sends, and still reads as a complete message. The employee gets
// a warm note over Rihal HR's name that answers nothing, and the only person who
// finds out is them.
//
// The other thing under test is the DEFAULT having exactly one owner. It used to
// be a literal beside the sender; a screen that edits a row while the sender
// falls back to its own private copy is two sources of truth for the words an
// employee receives.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** Escalation ids a reply token was minted for (ADR-070). */
const mintedFor: string[] = [];

type Templates = typeof import("../../lib/hive/services/email-template.ts");
let templates: Templates;

interface Row {
  key: string;
  subject: string;
  body: string;
  updatedAt: Date;
  updatedBy: { name: string } | null;
  /** Set by a soft delete. The filtered client then cannot see the row. */
  deletedAt?: Date | null;
}

let rows: Map<string, Row> = new Map();
let creates: Record<string, unknown>[] = [];
let updates: Record<string, unknown>[] = [];
let deletes: string[] = [];
let upserts = 0;

function reset() {
  rows = new Map();
  creates = [];
  updates = [];
  deletes = [];
  upserts = 0;
}

before(async () => {
  if (!canMock) return;
  // `escalation-queue.ts` reads `AUTH_URL` to build ADR-070's reply link and
  // mints the token through `reply-token.ts`. Both are replaced here: the link
  // is what this suite asserts about, and the real token module would want a
  // database.
  mockApi.module!(import.meta.resolve("../../lib/env.ts"), {
    namedExports: { env: { AUTH_URL: "https://hive.example" } },
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
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      // The queue module (imported by one test below) needs the name to exist.
      auditedTransaction: () => {
        throw new Error("not used by these tests");
      },
      prisma: {
        hiveEmailTemplate: {
          findUnique: async ({
            where,
            select,
          }: {
            where: { key: string };
            select: Record<string, unknown>;
          }) => {
            const row = rows.get(where.key);
            // The filtered client injects `deletedAt: null`, so a soft-deleted
            // row is invisible to every read — while still occupying its key.
            if (!row || row.deletedAt) return null;
            // Projected through `select`, so a read that stops asking for
            // `updatedBy` cannot keep passing on a mock that hands back
            // everything regardless.
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              out[key] = (row as unknown as Record<string, unknown>)[key];
            }
            return out;
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            // `key` is `@unique`, including against soft-deleted rows: the
            // constraint is in Postgres and knows nothing about `deletedAt`.
            const clash = rows.get(String(data.key));
            if (clash) {
              throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            }
            creates.push(data);
            rows.set(String(data.key), {
              key: String(data.key),
              subject: String(data.subject),
              body: String(data.body),
              updatedAt: new Date("2026-08-26T10:00:00Z"),
              updatedBy: { name: "Alaa Al Hinai" },
            });
            return data;
          },
          update: async ({
            where,
            data,
          }: {
            where: { key: string };
            data: Record<string, unknown>;
          }) => {
            updates.push({ key: where.key, ...data });
            const row = rows.get(where.key)!;
            row.subject = String(data.subject);
            row.body = String(data.body);
            return data;
          },
          // A SOFT delete, which is what the real client does — `EmailTemplate`
          // is in the soft-delete set, so `delete` sets `deletedAt` and leaves
          // the row holding its `@unique` key. A mock that removed the row
          // hid a real bug: reads would miss it (the screen looked reset) while
          // the next save would `create` a second row on the same key and fail.
          delete: async ({ where }: { where: { key: string } }) => {
            deletes.push(where.key);
            const row = rows.get(where.key);
            if (row) row.deletedAt = new Date();
            return {};
          },
          upsert: async () => {
            upserts += 1;
            return {};
          },
        },
      },
    },
  });
  templates = (await import(
    import.meta.resolve("../../lib/hive/services/email-template.ts")
  )) as Templates;
});

describe("§5.6 — the default is a starting point, not a fallback", { skip: !canMock }, () => {
  test("with no row, the §5.6 wording is returned and marked as not customised", async () => {
    reset();
    const t = await templates.loadTemplate("escalation-answer");
    assert.equal(t.customised, false);
    assert.equal(t.subject, templates.DEFAULT_TEMPLATE.subject);
    assert.equal(t.body, templates.DEFAULT_TEMPLATE.body);
    assert.equal(t.updatedAt, null);
  });

  test("the default carries §5.6's sequence, in §5.6's order", async () => {
    // "Warm opening line → the employee's original question, quoted back → the
    // HR-approved answer (the only variable part) → sign-off noting it was
    // reviewed by Rihal HR / the specific HR pair, with an invitation to ask the
    // bot again anytime."
    const body = templates.DEFAULT_TEMPLATE.body;
    const at = (needle: string) => body.indexOf(needle);
    assert.ok(at("{{employeeName}}") >= 0, "no warm opening naming the employee");
    assert.ok(at("{{question}}") > at("{{employeeName}}"), "the question is quoted back after it");
    assert.ok(at("{{answer}}") > at("{{question}}"), "the answer follows the question");
    assert.ok(at("{{hrPairName}}") > at("{{answer}}"), "the sign-off names the HR pair, last");
    assert.match(body, /> \{\{question\}\}/, "the question is QUOTED back, not restated");
  });

  test("customised tracks the TEXT, not whether a row exists", async () => {
    // The screen offers "back to the default" based on this. A stored copy of
    // the default text is not something to reset — and after a reset that is
    // exactly what the row holds.
    reset();
    await templates.saveTemplate("escalation-answer", { ...templates.DEFAULT_TEMPLATE }, "alaa");
    assert.equal((await templates.loadTemplate("escalation-answer")).customised, false);

    await templates.saveTemplate(
      "escalation-answer",
      { subject: "Reworded", body: templates.DEFAULT_TEMPLATE.body },
      "alaa",
    );
    assert.equal(
      (await templates.loadTemplate("escalation-answer")).customised,
      true,
      "a reworded SUBJECT is an edit too",
    );
  });

  test("the SEED writes the same default, rather than a copy of it", () => {
    // It used to transcribe the wording, and the two drifted immediately: 5.3b
    // added the reply line to the constant and the seed literal kept its own
    // phrasing, so a fresh install got one sentence and "back to the default"
    // restored a different one. Asserted against the SOURCE because running the
    // seed needs a database, and the property is about where the words come
    // from, not what they are.
    const seed = readFileSync(new URL("../../prisma/seed-hive.ts", import.meta.url), "utf8");
    assert.match(
      seed,
      /key: "escalation-answer", \.\.\.DEFAULT_TEMPLATE/,
      "REGRESSION: the seed transcribes §5.6's wording instead of importing it",
    );
    assert.doesNotMatch(
      seed,
      /thanks for reaching out/,
      "REGRESSION: a second copy of the default body is back in the seed",
    );
  });

  test("the default lives where a plain script can import it", () => {
    // `lib/hive/services/email-template.ts` imports `server-only`, which throws
    // outside Next — so a seed reaching in there cannot run at all. The constant
    // lives in the validations module for that reason, and moving it back would
    // break `npm run seed` rather than fail a type check.
    const val = readFileSync(
      new URL("../../lib/validations/hive/email-template.ts", import.meta.url),
      "utf8",
    );
    assert.match(val, /export const DEFAULT_TEMPLATE/);
    assert.doesNotMatch(val, /server-only/, "the pure module must stay importable");
  });

  test("the sender and the screen read the SAME default", async () => {
    // It used to be a literal beside the sender. Two copies of the words an
    // employee receives is one edit away from a screen that shows text nothing
    // sends.
    const queue = (await import(
      import.meta.resolve("../../lib/hive/services/escalation-queue.ts")
    )) as typeof import("../../lib/hive/services/escalation-queue.ts");
    const rendered = queue.renderTemplate(templates.DEFAULT_TEMPLATE, {
      employeeName: "Sara",
      question: "Can I carry over 15 days?",
      answer: "Up to 10 days carry over.",
      hrPairName: "Rahma & Mohammed",
      replyLink: null,
      ticketId: "HIVE-0007",
    });
    assert.match(rendered.text, /Up to 10 days carry over\./);
    assert.match(rendered.subject, /Answered/);
    assert.match(rendered.subject, /\(Ticket HIVE-0007\)/, "AC-T1.4: the subject names the ticket");
  });
});

describe("editing, and the one edit that is refused", { skip: !canMock }, () => {
  test("a first edit creates the row and records who made it", async () => {
    reset();
    const saved = await templates.saveTemplate(
      "escalation-answer",
      { subject: "Your HR question", body: "Hi {{employeeName}} — {{answer}}" },
      "muna",
    );
    assert.equal(creates[0].updatedById, "muna");
    assert.equal(saved.subject, "Your HR question");
    assert.equal(saved.customised, true);
  });

  test("a later edit updates rather than duplicating", async () => {
    reset();
    await templates.saveTemplate("escalation-answer", { subject: "A", body: "{{answer}}" }, "alaa");
    await templates.saveTemplate(
      "escalation-answer",
      { subject: "B", body: "{{answer}}!" },
      "muna",
    );
    assert.equal(creates.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].updatedById, "muna");
  });

  test("the write is a create/update pair, never an upsert", async () => {
    // The audit extension hooks `create`, `update` and `delete` and NOT
    // `upsert`. An upsert here would change the words an employee receives over
    // HR's name and leave no trail of who changed them.
    reset();
    await templates.saveTemplate("escalation-answer", { subject: "A", body: "{{answer}}" }, "alaa");
    await templates.saveTemplate("escalation-answer", { subject: "B", body: "{{answer}}" }, "alaa");
    assert.equal(upserts, 0, "REGRESSION: an unaudited upsert replaced the create/update pair");
  });

  test("a body without {{answer}} is refused at the boundary", async () => {
    const schema = (await import(
      import.meta.resolve("../../lib/validations/hive/email-template.ts")
    )) as typeof import("../../lib/validations/hive/email-template.ts");
    const result = schema.emailTemplateSchema.safeParse({
      subject: "Your question to HIVE — Answered",
      body: "Hi {{employeeName}}, thanks for reaching out! Ask HIVE again any time.",
    });
    assert.equal(result.success, false, "REGRESSION: a template that sends no answer can be saved");
    assert.match(
      result.error!.issues[0].message,
      /\{\{answer\}\}/,
      "the message must name the placeholder, not just say 'invalid'",
    );
  });

  test("a body WITH {{answer}} is accepted, however else it is worded", async () => {
    const schema = (await import(
      import.meta.resolve("../../lib/validations/hive/email-template.ts")
    )) as typeof import("../../lib/validations/hive/email-template.ts");
    // §5.6 lets Alaa reword the opening line and the sign-off freely. Only the
    // one placeholder is mandatory.
    assert.ok(
      schema.emailTemplateSchema.safeParse({ subject: "Answered", body: "{{answer}}" }).success,
    );
  });

  test("an empty subject is refused — an email with no subject line is a spam flag", async () => {
    const schema = (await import(
      import.meta.resolve("../../lib/validations/hive/email-template.ts")
    )) as typeof import("../../lib/validations/hive/email-template.ts");
    assert.equal(
      schema.emailTemplateSchema.safeParse({ subject: "   ", body: "{{answer}}" }).success,
      false,
    );
  });
});

describe("resetting goes back to §5.6's wording", { skip: !canMock }, () => {
  test("reset restores the default text and clears the 'customised' state", async () => {
    reset();
    await templates.saveTemplate("escalation-answer", { subject: "A", body: "{{answer}}" }, "alaa");
    const after = await templates.resetTemplate("escalation-answer", "alaa");
    assert.equal(after.customised, false);
    assert.equal(after.body, templates.DEFAULT_TEMPLATE.body);
    assert.equal(after.subject, templates.DEFAULT_TEMPLATE.subject);
  });

  test("reset does NOT delete the row — a tombstone would brick the next save", async () => {
    // `EmailTemplate` is soft-deleted, so a `delete` here sets `deletedAt` and
    // leaves the row holding its `@unique` key. Reads would then miss it (the
    // screen looks reset, correctly) while the next save would `create` a
    // second row on the same key and fail on the constraint — editing
    // permanently broken, for anyone who reset and then changed their mind.
    reset();
    await templates.saveTemplate("escalation-answer", { subject: "A", body: "{{answer}}" }, "alaa");
    await templates.resetTemplate("escalation-answer", "alaa");
    assert.deepEqual(deletes, [], "REGRESSION: reset soft-deletes the row it must reuse");

    const saved = await templates.saveTemplate(
      "escalation-answer",
      { subject: "B", body: "Second thoughts: {{answer}}" },
      "muna",
    );
    assert.equal(saved.subject, "B", "REGRESSION: editing after a reset fails");
    assert.equal(saved.customised, true);
  });

  test("resetting when nothing is stored is a no-op, not an error", async () => {
    reset();
    const after = await templates.resetTemplate("escalation-answer", "alaa");
    assert.equal(after.customised, false);
    assert.equal(deletes.length, 0);
  });

  test("a row that happens to hold the default is not 'customised'", async () => {
    // Which is what a reset leaves behind, and also what an admin who typed the
    // default back by hand leaves behind. Offering "back to the default" there
    // is a button that does nothing.
    reset();
    await templates.saveTemplate("escalation-answer", { ...templates.DEFAULT_TEMPLATE }, "alaa");
    const t = await templates.loadTemplate("escalation-answer");
    assert.equal(t.customised, false);
  });
});
