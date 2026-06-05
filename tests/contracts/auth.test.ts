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
    jwt: (a: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Record<string, unknown>;
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

  await import(import.meta.resolve("../../lib/auth.ts"));
});

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

test("jwt: copies id + role from the user on sign-in", { skip: !canMock }, () => {
  const token = config.callbacks.jwt({
    token: {},
    user: { id: "u9", role: "EDITOR" },
  });
  assert.equal(token.id, "u9");
  assert.equal(token.role, "EDITOR");
});

test("jwt: leaves the token unchanged on subsequent calls (no user)", { skip: !canMock }, () => {
  const token = config.callbacks.jwt({
    token: { id: "u9", role: "ADMIN" },
    user: undefined,
  });
  assert.equal(token.id, "u9");
  assert.equal(token.role, "ADMIN");
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
