// Contract tests for lib/sso/* — the WS-6 enterprise-identity seam (ADR-045):
// the Polis SSO config gate + SCIM HMAC verify (pure, no mocks), and the SCIM
// provisioning mapping (mocks lib/prisma the same way auth.test.ts / ai-rag.test.ts
// do). Provisioning cases self-skip without --experimental-test-module-mocks.
//
//   node --experimental-test-module-mocks --import tsx \
//     --test tests/contracts/sso.test.ts

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Pure gate + verify helpers — import directly (no prisma dependency).
import {
  isPolisSsoConfigured,
  polisSsoConfig,
  scimWebhookSecret,
  verifyScimSignature,
  SsoNotConfiguredError,
} from "../../lib/sso/config";

const mockApi = mock as unknown as {
  module?: (
    specifier: string,
    options: { namedExports?: Record<string, unknown> },
  ) => unknown;
};
const canMock = typeof mockApi.module === "function";

// --- Polis SSO config gate (ADR-045) ---------------------------------------

const FULL = {
  POLIS_ISSUER: "http://polis:5225",
  POLIS_CLIENT_ID: "client-1",
  POLIS_CLIENT_SECRET: "secret-1",
};

test("isPolisSsoConfigured: requires issuer + id + secret together", () => {
  assert.equal(isPolisSsoConfigured({}), false);
  assert.equal(isPolisSsoConfigured({ POLIS_ISSUER: FULL.POLIS_ISSUER }), false);
  assert.equal(
    isPolisSsoConfigured({ POLIS_ISSUER: FULL.POLIS_ISSUER, POLIS_CLIENT_ID: FULL.POLIS_CLIENT_ID }),
    false,
    "id+issuer without secret must stay dormant (no broken button)",
  );
  assert.equal(isPolisSsoConfigured({ ...FULL }), true);
});

test("isPolisSsoConfigured: whitespace-only values do not count as set", () => {
  assert.equal(
    isPolisSsoConfigured({ POLIS_ISSUER: "  ", POLIS_CLIENT_ID: "  ", POLIS_CLIENT_SECRET: "  " }),
    false,
  );
});

test("polisSsoConfig: resolves + trims + surfaces optional tenant/product", () => {
  const cfg = polisSsoConfig({ ...FULL, POLIS_SAML_TENANT: " acme ", POLIS_SAML_PRODUCT: "app" });
  assert.equal(cfg.issuer, "http://polis:5225");
  assert.equal(cfg.clientId, "client-1");
  assert.equal(cfg.clientSecret, "secret-1");
  assert.equal(cfg.tenant, "acme");
  assert.equal(cfg.product, "app");
});

test("polisSsoConfig: undefined tenant/product when unset", () => {
  const cfg = polisSsoConfig({ ...FULL });
  assert.equal(cfg.tenant, undefined);
  assert.equal(cfg.product, undefined);
});

test("polisSsoConfig: throws SsoNotConfiguredError when unconfigured", () => {
  assert.throws(() => polisSsoConfig({}), SsoNotConfiguredError);
});

// --- SCIM webhook secret + HMAC verify -------------------------------------

test("scimWebhookSecret: undefined unless a non-blank value is set", () => {
  assert.equal(scimWebhookSecret({}), undefined);
  assert.equal(scimWebhookSecret({ SCIM_WEBHOOK_SECRET: "   " }), undefined);
  assert.equal(scimWebhookSecret({ SCIM_WEBHOOK_SECRET: "s3cret" }), "s3cret");
});

test("verifyScimSignature: accepts a correct HMAC-SHA256 hex digest", () => {
  const body = '{"event":"user.created"}';
  const secret = "webhook-secret";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyScimSignature(body, sig, secret), true);
});

test("verifyScimSignature: accepts a prefixed (t=..,s=<hex>) signature", () => {
  const body = '{"event":"user.updated"}';
  const secret = "webhook-secret";
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyScimSignature(body, `t=123,s=${hex}`, secret), true);
});

test("verifyScimSignature: rejects a wrong signature, missing header, and tampered body", () => {
  const body = '{"event":"user.created"}';
  const secret = "webhook-secret";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyScimSignature(body, "deadbeef", secret), false, "wrong digest");
  assert.equal(verifyScimSignature(body, null, secret), false, "missing header");
  assert.equal(verifyScimSignature(body, undefined, secret), false, "undefined header");
  assert.equal(verifyScimSignature('{"event":"user.deleted"}', sig, secret), false, "tampered body");
});

// --- SCIM provisioning (mocks lib/prisma) ----------------------------------

let findUniqueResult: Record<string, unknown> | null = null;
let createCalls: unknown[] = [];
let updateCalls: unknown[] = [];
let deleteCalls: unknown[] = [];
let createError: unknown = null;

let scimMod: {
  normalizeDirectoryEvent: (raw: unknown) => {
    type: string;
    email: string;
    name: string | null;
    active: boolean;
  } | null;
  provisionDirectoryEvent: (evt: {
    type: string;
    email: string;
    name: string | null;
    active: boolean;
  }) => Promise<{ action: string }>;
};

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        user: {
          findUnique: async () => findUniqueResult,
          create: async (args: unknown) => {
            createCalls.push(args);
            if (createError) throw createError;
            return {};
          },
          update: async (args: unknown) => {
            updateCalls.push(args);
            return {};
          },
          delete: async (args: unknown) => {
            deleteCalls.push(args);
            return {};
          },
        },
      },
    },
  });
  scimMod = (await import(import.meta.resolve("../../lib/sso/scim.ts"))) as typeof scimMod;
});

beforeEach(() => {
  findUniqueResult = null;
  createCalls = [];
  updateCalls = [];
  deleteCalls = [];
  createError = null;
});

// normalizeDirectoryEvent lives in scim.ts (dynamic-imported after the mock).

test("normalizeDirectoryEvent: ignores non-user + emailless + malformed events", { skip: !canMock }, () => {
  assert.equal(scimMod.normalizeDirectoryEvent(null), null);
  assert.equal(scimMod.normalizeDirectoryEvent({ event: "group.created", data: { email: "g@x.com" } }), null);
  assert.equal(scimMod.normalizeDirectoryEvent({ event: "user.created", data: {} }), null, "no email");
});

test("normalizeDirectoryEvent: user.created lowercases email + builds name from first/last", { skip: !canMock }, () => {
  const evt = scimMod.normalizeDirectoryEvent({
    event: "user.created",
    data: { email: "  Ada@Example.COM ", first_name: "Ada", last_name: "Lovelace" },
  });
  assert.deepEqual(evt, { type: "user.created", email: "ada@example.com", name: "Ada Lovelace", active: true });
});

test("normalizeDirectoryEvent: user.deleted is always a deactivation", { skip: !canMock }, () => {
  const evt = scimMod.normalizeDirectoryEvent({ event: "user.deleted", data: { email: "x@y.com", active: true } });
  assert.equal(evt?.active, false, "a delete event deactivates regardless of active flag");
});

test("normalizeDirectoryEvent: active:false on an update is a deactivation", { skip: !canMock }, () => {
  const evt = scimMod.normalizeDirectoryEvent({ event: "user.updated", data: { email: "x@y.com", active: false } });
  assert.equal(evt?.active, false);
});

test("normalizeDirectoryEvent: a string 'false' active is also a deactivation", { skip: !canMock }, () => {
  const evt = scimMod.normalizeDirectoryEvent({ event: "user.updated", data: { email: "x@y.com", active: "false" } });
  assert.equal(evt?.active, false, "string-serialized active must not be misread as active");
});

test("provision: user.created for a new email creates a VIEWER", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await scimMod.provisionDirectoryEvent({ type: "user.created", email: "new@x.com", name: "New", active: true });
  assert.equal(out.action, "created");
  assert.equal(createCalls.length, 1);
  const data = (createCalls[0] as { data: { role: string; email: string } }).data;
  assert.equal(data.role, "VIEWER", "least privilege on create");
  assert.equal(data.email, "new@x.com");
});

test("provision: active create for a soft-deleted email (rehire, P2002) => noop", { skip: !canMock }, async () => {
  findUniqueResult = null; // audited client can't see the soft-deleted row
  createError = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  const out = await scimMod.provisionDirectoryEvent({ type: "user.created", email: "rehire@x.com", name: "R", active: true });
  assert.equal(out.action, "noop", "documented v1 limitation, not a 500");
});

test("provision: a non-P2002 create error propagates", { skip: !canMock }, async () => {
  findUniqueResult = null;
  createError = Object.assign(new Error("db down"), { code: "P1001" });
  await assert.rejects(
    scimMod.provisionDirectoryEvent({ type: "user.created", email: "x@x.com", name: null, active: true }),
    /db down/,
  );
});

test("provision: user.updated changes the name only, never the role", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u1", name: "Old" };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "x@x.com", name: "New", active: true });
  assert.equal(out.action, "updated");
  assert.equal(updateCalls.length, 1);
  const data = (updateCalls[0] as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data), ["name"], "update touches name ONLY (role/promotion preserved)");
  assert.equal(data.name, "New");
});

test("provision: update with an unchanged name is a noop", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u1", name: "Same" };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "x@x.com", name: "Same", active: true });
  assert.equal(out.action, "noop");
  assert.equal(updateCalls.length, 0);
});

test("provision: deactivation soft-deletes a live user (off-board)", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u9", name: "Gone" };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.deleted", email: "gone@x.com", name: null, active: false });
  assert.equal(out.action, "deactivated");
  assert.equal(deleteCalls.length, 1, "soft-delete via prisma.user.delete");
  assert.equal((deleteCalls[0] as { where: { id: string } }).where.id, "u9");
});

test("provision: deactivating an unknown user is a noop (no error)", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await scimMod.provisionDirectoryEvent({ type: "user.deleted", email: "ghost@x.com", name: null, active: false });
  assert.equal(out.action, "noop");
  assert.equal(deleteCalls.length, 0);
});
