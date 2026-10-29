import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  effectivePreference,
  NOTIFICATION_KINDS,
  NOTIFICATION_REGISTRY,
} from "../../lib/core/notify/registry";

// ADR-095: one email log + sender, one template store, and the notification
// registry with per-person preferences.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

let logged: Record<string, unknown>[] = [];
let transport: "ok" | "off" | "throw" = "ok";
type Send = typeof import("../../lib/core/email/send.ts");
let send: Send;

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/email.ts"), {
    namedExports: {
      sendEmail: async () => {
        if (transport === "throw") throw new Error("smtp down");
        return transport === "ok" ? { sent: true, messageId: "m1" } : { sent: false };
      },
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        emailLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            logged.push(data);
            return {};
          },
        },
      },
    },
  });
  send = (await import(import.meta.resolve("../../lib/core/email/send.ts"))) as Send;
});

const meta = {
  module: "tickets",
  type: "escalation-answer",
  subjectType: "tickets.escalation",
  subjectId: "e1",
} as const;
const opts = { to: "a@example.com", subject: "Answered", text: "SECRET BODY" };

test("every NotificationKind is registered (the type makes a new kind a compile error)", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const block = schema.slice(schema.indexOf("enum NotificationKind {"));
  const kinds = [...block.slice(0, block.indexOf("}")).matchAll(/^\s+([A-Z_]+)/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual([...kinds].sort(), [...NOTIFICATION_KINDS].sort());
});

test("mandatory kinds can't be muted; optional ones follow the person's choice", () => {
  assert.equal(NOTIFICATION_REGISTRY.CYCLE_ESCALATION.mandatory, true);
  assert.deepEqual(effectivePreference("CYCLE_ESCALATION", { inApp: false }), {
    inApp: true,
    email: false,
  });
  assert.deepEqual(effectivePreference("TICKET_TO_DRAFT", { inApp: false, email: false }), {
    inApp: false,
    email: false,
  });
  assert.deepEqual(effectivePreference("TICKET_TO_DRAFT"), { inApp: true, email: true });
  // A kind with no email of its own never claims one.
  assert.equal(effectivePreference("JML_INFO", { email: true }).email, false);
});

test("a sent email is logged with metadata only — never the body", { skip: !canMock }, async () => {
  logged = [];
  transport = "ok";
  await send.sendLoggedEmail(opts, meta);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].status, "SENT");
  assert.equal(logged[0].module, "tickets");
  assert.ok(!JSON.stringify(logged[0]).includes("SECRET BODY"));
});

test(
  "an unconfigured transport is logged as FAILED and still returns sent: false",
  { skip: !canMock },
  async () => {
    logged = [];
    transport = "off";
    assert.deepEqual(await send.sendLoggedEmail(opts, meta), { sent: false });
    assert.equal(logged[0].status, "FAILED");
    assert.match(String(logged[0].failureReason), /not configured/);
  },
);

test("a transport error is logged and re-thrown, as before", { skip: !canMock }, async () => {
  logged = [];
  transport = "throw";
  await assert.rejects(send.sendLoggedEmail(opts, meta), /smtp down/);
  assert.equal(logged[0].status, "FAILED");
});

test("JML's drain only sends JML's queue (the log is shared)", () => {
  const queue = readFileSync("lib/jml/email/queue.ts", "utf8");
  assert.match(queue, /module: "jml",\s*status: "QUEUED"/);
});
