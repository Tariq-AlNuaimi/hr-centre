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
  isFederatedSignInAllowed,
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

// --- Federated sign-in guard (ADR-045 A1; pure) ----------------------------

test("isFederatedSignInAllowed: null row (new user) is allowed", () => {
  assert.equal(isFederatedSignInAllowed(null, "polis"), true);
});

test("isFederatedSignInAllowed: a soft-deleted row is denied for any provider", () => {
  const row = { deletedAt: new Date(), passwordHash: null };
  assert.equal(isFederatedSignInAllowed(row, "polis"), false);
  assert.equal(isFederatedSignInAllowed(row, "microsoft-entra-id"), false);
});

test("isFederatedSignInAllowed: Polis link to a PASSWORD user is denied (takeover guard)", () => {
  assert.equal(
    isFederatedSignInAllowed({ deletedAt: null, passwordHash: "$argon2id$x" }, "polis"),
    false,
    "a real password user must not be auto-linked via a spoofable SSO email",
  );
});

test("isFederatedSignInAllowed: Polis link to a PASSWORDLESS (SCIM) row is allowed", () => {
  assert.equal(
    isFederatedSignInAllowed({ deletedAt: null, passwordHash: null }, "polis"),
    true,
    "the SCIM-provisioned passwordless row is claimable — US-1/US-2",
  );
});

test("isFederatedSignInAllowed: guard is Polis-scoped (Entra passwordHash row not blocked here)", () => {
  assert.equal(
    isFederatedSignInAllowed({ deletedAt: null, passwordHash: "$argon2id$x" }, "microsoft-entra-id"),
    true,
    "Entra keeps allowDangerousEmailAccountLinking OFF; its collisions block upstream",
  );
});

// --- SCIM provisioning (mocks lib/prisma) ----------------------------------

// findUniqueResult drives the EMAIL lookup; findByExternalIdResult drives the
// scimExternalId lookup (findExistingUser tries the directory id first). Keeping
// them separate lets a test exercise the rename-correlation branch precisely.
let findUniqueResult: Record<string, unknown> | null = null;
let findByExternalIdResult: Record<string, unknown> | null = null;
let createCalls: unknown[] = [];
let updateCalls: unknown[] = [];
let deleteCalls: unknown[] = [];
let createError: unknown = null;
let updateError: unknown = null;

type ScimEvt = {
  type: string;
  email: string;
  name: string | null;
  active: boolean;
  externalId: string | null;
};

let scimMod: {
  normalizeDirectoryEvent: (raw: unknown) => ScimEvt | null;
  provisionDirectoryEvent: (evt: ScimEvt) => Promise<{ action: string }>;
};

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        user: {
          findUnique: async (args: unknown) => {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            return "scimExternalId" in where ? findByExternalIdResult : findUniqueResult;
          },
          create: async (args: unknown) => {
            createCalls.push(args);
            if (createError) throw createError;
            return {};
          },
          update: async (args: unknown) => {
            updateCalls.push(args);
            if (updateError) throw updateError;
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
  findByExternalIdResult = null;
  createCalls = [];
  updateCalls = [];
  deleteCalls = [];
  createError = null;
  updateError = null;
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
  assert.deepEqual(evt, { type: "user.created", email: "ada@example.com", name: "Ada Lovelace", active: true, externalId: null });
});

test("normalizeDirectoryEvent: captures the stable directory id (data.id) as externalId", { skip: !canMock }, () => {
  const evt = scimMod.normalizeDirectoryEvent({
    event: "user.updated",
    data: { id: " dir-42 ", email: "x@y.com", name: "X" },
  });
  assert.equal(evt?.externalId, "dir-42", "trimmed directory id used for rename-safe correlation");
  const none = scimMod.normalizeDirectoryEvent({ event: "user.updated", data: { email: "x@y.com" } });
  assert.equal(none?.externalId, null, "absent data.id => null (falls back to email correlation)");
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

test("provision: user.created for a new email creates a VIEWER + stamps externalId", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await scimMod.provisionDirectoryEvent({ type: "user.created", email: "new@x.com", name: "New", active: true, externalId: "dir-1" });
  assert.equal(out.action, "created");
  assert.equal(createCalls.length, 1);
  const data = (createCalls[0] as { data: { role: string; email: string; scimExternalId: string | null } }).data;
  assert.equal(data.role, "VIEWER", "least privilege on create");
  assert.equal(data.email, "new@x.com");
  assert.equal(data.scimExternalId, "dir-1", "directory id stamped for future rename-safe correlation");
});

test("provision: active create for a soft-deleted email (rehire, P2002) => noop", { skip: !canMock }, async () => {
  findUniqueResult = null; // audited client can't see the soft-deleted row
  createError = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  const out = await scimMod.provisionDirectoryEvent({ type: "user.created", email: "rehire@x.com", name: "R", active: true, externalId: null });
  assert.equal(out.action, "noop", "documented v1 limitation, not a 500");
});

test("provision: a non-P2002 create error propagates", { skip: !canMock }, async () => {
  findUniqueResult = null;
  createError = Object.assign(new Error("db down"), { code: "P1001" });
  await assert.rejects(
    scimMod.provisionDirectoryEvent({ type: "user.created", email: "x@x.com", name: null, active: true, externalId: null }),
    /db down/,
  );
});

test("provision: user.updated changes the name only, never the role", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u1", email: "x@x.com", name: "Old", scimExternalId: null };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "x@x.com", name: "New", active: true, externalId: null });
  assert.equal(out.action, "updated");
  assert.equal(updateCalls.length, 1);
  const data = (updateCalls[0] as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data), ["name"], "update touches name ONLY (role/promotion preserved)");
  assert.equal(data.name, "New");
});

test("provision: update with an unchanged name is a noop", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u1", email: "x@x.com", name: "Same", scimExternalId: null };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "x@x.com", name: "Same", active: true, externalId: null });
  assert.equal(out.action, "noop");
  assert.equal(updateCalls.length, 0);
});

test("provision: a directory email RENAME (matched by externalId) updates the email in place, no orphan row", { skip: !canMock }, async () => {
  // findExistingUser matches by scimExternalId first, so the OLD-email row is found
  // even though the event carries the NEW email.
  findByExternalIdResult = { id: "u1", email: "old@x.com", name: "Ada", scimExternalId: "dir-7" };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "new@x.com", name: "Ada", active: true, externalId: "dir-7" });
  assert.equal(out.action, "updated");
  assert.equal(createCalls.length, 0, "no second row created — this is the US-3 rename fix");
  assert.equal(updateCalls.length, 1);
  const data = (updateCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.email, "new@x.com", "the existing row's email is updated in place");
});

test("provision: backfills externalId onto a row first matched by email", { skip: !canMock }, async () => {
  findByExternalIdResult = null; // no row carries this directory id yet
  findUniqueResult = { id: "u1", email: "x@x.com", name: "N", scimExternalId: null };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "x@x.com", name: "N", active: true, externalId: "dir-9" });
  assert.equal(out.action, "updated");
  const data = (updateCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.scimExternalId, "dir-9", "the directory id is backfilled for future rename-safe correlation");
});

test("provision: a rename colliding with another live email => noop (no 500)", { skip: !canMock }, async () => {
  findByExternalIdResult = { id: "u1", email: "old@x.com", name: "A", scimExternalId: "dir-7" };
  // The email-rename UPDATE hits a unique violation (another live row owns new@x.com).
  updateError = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  const out = await scimMod.provisionDirectoryEvent({ type: "user.updated", email: "new@x.com", name: "A", active: true, externalId: "dir-7" });
  assert.equal(out.action, "noop", "a directory-side duplicate must not 500 the webhook");
});

test("provision: deactivation soft-deletes a live user (off-board)", { skip: !canMock }, async () => {
  findUniqueResult = { id: "u9", email: "gone@x.com", name: "Gone", scimExternalId: null };
  const out = await scimMod.provisionDirectoryEvent({ type: "user.deleted", email: "gone@x.com", name: null, active: false, externalId: null });
  assert.equal(out.action, "deactivated");
  assert.equal(deleteCalls.length, 1, "soft-delete via prisma.user.delete");
  assert.equal((deleteCalls[0] as { where: { id: string } }).where.id, "u9");
});

test("provision: deactivating an unknown user is a noop (no error)", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await scimMod.provisionDirectoryEvent({ type: "user.deleted", email: "ghost@x.com", name: null, active: false, externalId: null });
  assert.equal(out.action, "noop");
  assert.equal(deleteCalls.length, 0);
});
