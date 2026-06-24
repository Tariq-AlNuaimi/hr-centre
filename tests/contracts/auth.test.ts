// Contract tests for lib/auth.ts — the Credentials `authorize` flow and the
// jwt/session callbacks (role propagation). These live inside the NextAuth({...})
// config object and aren't individually exported, so we mock `next-auth` (and the
// provider/adapter/prisma/bcrypt graph) to CAPTURE the config object lib/auth.ts
// passes to NextAuth, then invoke the real closures. No change to lib/auth.ts.
//
// Runs DB-free under node:test's module mocks (requires --experimental-test-
// module-mocks, which the `test` npm script already passes). Without the flag,
// every case self-skips rather than failing.
//
//   node --experimental-test-module-mocks --import tsx \
//     --test tests/contracts/auth.test.ts

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const mockApi = mock as unknown as {
  module?: (
    specifier: string,
    options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
  ) => unknown;
};
const canMock = typeof mockApi.module === "function";

// --- mutable stubs the captured closures read through ----------------------
let findUniqueArgs: unknown = null;
let findUniqueResult: Record<string, unknown> | null = null;
let updateCalls: unknown[] = [];
let compareResult = false;

// The NextAuth config lib/auth.ts builds (captured by the mocked NextAuth).
let config: {
  providers: Array<{
    authorize: (
      c: Record<string, unknown> | undefined,
    ) => Promise<Record<string, unknown> | null>;
  }>;
  callbacks: {
    jwt: (a: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
    session: (a: { session: { user?: Record<string, unknown> }; token: Record<string, unknown> }) => { user?: Record<string, unknown> };
  };
};

before(async () => {
  if (!canMock) return;

  // Capture the config object passed to NextAuth(); return a dummy shape.
  mockApi.module!("next-auth", {
    defaultExport: (cfg: typeof config) => {
      config = cfg;
      return { handlers: {}, signIn: () => {}, signOut: () => {}, auth: () => {} };
    },
  });
  // Credentials(cfg) just returns cfg so providers[0].authorize is reachable.
  mockApi.module!("next-auth/providers/credentials", {
    defaultExport: (cfg: unknown) => cfg,
  });
  // MicrosoftEntraID(cfg) → cfg (only invoked when SSO env is set; unset here).
  mockApi.module!("next-auth/providers/microsoft-entra-id", {
    defaultExport: (cfg: unknown) => cfg,
  });
  mockApi.module!("@auth/prisma-adapter", {
    namedExports: { PrismaAdapter: () => ({}) },
  });
  // bcryptjs default export object with a controllable compare().
  mockApi.module!("bcryptjs", {
    defaultExport: { compare: async () => compareResult },
  });
  // prismaUnfiltered stub: record findUnique args + update calls.
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {},
      prismaUnfiltered: {
        user: {
          findUnique: async (args: unknown) => {
            findUniqueArgs = args;
            return findUniqueResult;
          },
          update: async (args: unknown) => {
            updateCalls.push(args);
            return {};
          },
        },
      },
    },
  });

  authMod = (await import(import.meta.resolve("../../lib/auth.ts"))) as typeof authMod;
});

// Named exports under test for SSO gating (ADR-024). Pure helpers, env-driven.
let authMod: {
  ssoProviderPlan: (env?: Record<string, string | undefined>) => {
    configured: boolean;
    enforced: boolean;
    credentialsEnabled: boolean;
    ssoEnabled: boolean;
  };
  mapSsoRole: (claims: Record<string, unknown> | undefined) => string;
};

beforeEach(() => {
  findUniqueArgs = null;
  findUniqueResult = null;
  updateCalls = [];
  compareResult = false;
});

const VALID_USER = {
  id: "u1",
  email: "user@example.com",
  name: "User",
  image: null,
  role: "ADMIN",
  passwordHash: "hashed",
  passwordChangedAt: null,
};

// --- authorize -------------------------------------------------------------

test("authorize: returns null when credentials are missing", { skip: !canMock }, async () => {
  const { authorize } = config.providers[0];
  assert.equal(await authorize(undefined), null);
  assert.equal(await authorize({ email: "a@b.com" }), null); // no password
  assert.equal(await authorize({ password: "x" }), null); // no email
});

test("authorize: returns null when the user does not exist", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const out = await config.providers[0].authorize({
    email: "nobody@example.com",
    password: "whatever",
  });
  assert.equal(out, null);
});

test("authorize: returns null when the user has no passwordHash (e.g. OAuth-only)", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER, passwordHash: null };
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "whatever",
  });
  assert.equal(out, null);
});

test("authorize: returns null when the password is wrong", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = false;
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "wrong",
  });
  assert.equal(out, null);
  assert.equal(updateCalls.length, 0, "must not stamp lastLoginAt on a failed login");
});

test("authorize: valid login returns the user (with role) and stamps lastLoginAt", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = true;
  const out = await config.providers[0].authorize({
    email: "user@example.com",
    password: "correct",
  });
  assert.deepEqual(out, {
    id: "u1",
    email: "user@example.com",
    name: "User",
    image: null,
    role: "ADMIN",
    passwordChangedAt: null,
  });
  // (assert.deepEqual above narrows `out` to the literal shape, so widen back to
  // index a key it intentionally must NOT carry.)
  assert.equal((out as Record<string, unknown>).passwordHash, undefined, "must NOT leak passwordHash to the session");
  assert.equal(updateCalls.length, 1, "should stamp lastLoginAt exactly once");
  const data = (updateCalls[0] as { data: { lastLoginAt: unknown } }).data;
  assert.ok(data.lastLoginAt instanceof Date, "lastLoginAt should be a Date");
});

test("authorize: looks the user up by normalized (lowercased, trimmed) email + deletedAt:null", { skip: !canMock }, async () => {
  findUniqueResult = { ...VALID_USER };
  compareResult = true;
  await config.providers[0].authorize({
    email: "  USER@Example.COM  ",
    password: "correct",
  });
  const where = (findUniqueArgs as { where: { email: string; deletedAt: null } }).where;
  assert.equal(where.email, "user@example.com", "email must be lowercased + trimmed");
  assert.equal(where.deletedAt, null, "must exclude soft-deleted users from login");
});

// --- jwt callback ----------------------------------------------------------

test("jwt: copies id + role + password epoch from the user on sign-in", { skip: !canMock }, async () => {
  const token = await config.callbacks.jwt({
    token: {},
    user: { id: "u9", role: "EDITOR", passwordChangedAt: new Date(1000) },
  });
  assert.ok(token);
  assert.equal(token.id, "u9");
  assert.equal(token.role, "EDITOR");
  assert.equal(token.passwordChangedAt, 1000, "binds the token to the password epoch");
});

test("jwt: defaults password epoch to 0 when the user never changed it", { skip: !canMock }, async () => {
  const token = await config.callbacks.jwt({
    token: {},
    user: { id: "u9", role: "VIEWER", passwordChangedAt: null },
  });
  assert.equal(token?.passwordChangedAt, 0);
});

test("jwt: keeps the token on subsequent calls when the password is unchanged", { skip: !canMock }, async () => {
  // DB reports the same epoch the token carries -> token survives.
  findUniqueResult = { passwordChangedAt: new Date(500) };
  const token = await config.callbacks.jwt({
    token: { id: "u9", role: "ADMIN", passwordChangedAt: 500 },
    user: undefined,
  });
  assert.ok(token, "token should not be revoked");
  assert.equal(token.id, "u9");
  assert.equal(token.role, "ADMIN");
  const where = (findUniqueArgs as { where: { id: string } }).where;
  assert.equal(where.id, "u9", "revocation check looks the user up by token.id");
});

test("jwt: REVOKES the token when the password changed after it was issued", { skip: !canMock }, async () => {
  // Password reset stamped a newer epoch than the token's -> reject (return null).
  findUniqueResult = { passwordChangedAt: new Date(9999) };
  const token = await config.callbacks.jwt({
    token: { id: "u9", role: "ADMIN", passwordChangedAt: 500 },
    user: undefined,
  });
  assert.equal(token, null, "a stale pre-reset session must be torn down");
});

test("jwt: REVOKES the token when the user no longer exists", { skip: !canMock }, async () => {
  findUniqueResult = null;
  const token = await config.callbacks.jwt({
    token: { id: "gone", role: "ADMIN", passwordChangedAt: 0 },
    user: undefined,
  });
  assert.equal(token, null);
});

// --- session callback ------------------------------------------------------

test("session: projects id + role from the token onto session.user", { skip: !canMock }, () => {
  const session = config.callbacks.session({
    session: { user: { email: "user@example.com" } },
    token: { id: "u1", role: "VIEWER" },
  });
  assert.equal(session.user?.id, "u1");
  assert.equal(session.user?.role, "VIEWER");
});

test("session: tolerates a session with no user (no throw)", { skip: !canMock }, () => {
  const session = config.callbacks.session({
    session: {},
    token: { id: "u1", role: "VIEWER" },
  });
  assert.ok(session, "should return the session object even when user is absent");
});

// --- SSO provider gating (ADR-024) -----------------------------------------

test("ssoProviderPlan: no SSO env -> credentials only, SSO dormant", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({});
  assert.equal(plan.configured, false);
  assert.equal(plan.ssoEnabled, false);
  assert.equal(plan.credentialsEnabled, true, "password login stays on by default");
});

test("ssoProviderPlan: Entra configured (id+secret), not enforced -> BOTH providers", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-123",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "shh",
  });
  assert.equal(plan.configured, true);
  assert.equal(plan.ssoEnabled, true, "Entra registered once id+secret are set");
  assert.equal(plan.credentialsEnabled, true, "password login remains alongside SSO");
});

test("ssoProviderPlan: id WITHOUT secret -> NOT configured (no broken button)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ AUTH_MICROSOFT_ENTRA_ID_ID: "client-123" });
  assert.equal(plan.configured, false, "a half-set config must not enable SSO");
  assert.equal(plan.ssoEnabled, false);
  assert.equal(plan.credentialsEnabled, true);
});

test("ssoProviderPlan: configured AND enforced -> SSO ONLY (closes T-02)", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-123",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "shh",
    AUTH_ENFORCE_SSO: "true",
  });
  assert.equal(plan.ssoEnabled, true);
  assert.equal(plan.credentialsEnabled, false, "credentials removed so IdP MFA is mandatory");
});

test("ssoProviderPlan: enforce flag alone (no Entra) does NOT lock out password login", { skip: !canMock }, () => {
  const plan = authMod.ssoProviderPlan({ AUTH_ENFORCE_SSO: "true" });
  assert.equal(plan.configured, false);
  assert.equal(plan.ssoEnabled, false);
  assert.equal(plan.credentialsEnabled, true, "never strand a fork with no usable provider");
});

test("mapSsoRole: defaults to VIEWER (least privilege) for any claims", { skip: !canMock }, () => {
  assert.equal(authMod.mapSsoRole(undefined), "VIEWER");
  assert.equal(authMod.mapSsoRole({ groups: ["app-admins"] }), "VIEWER");
});

test("default build (no SSO env at import) registers exactly the credentials provider", { skip: !canMock }, () => {
  assert.equal(config.providers.length, 1, "SSO must stay dormant unless env opts in");
});
