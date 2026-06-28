// DB-backed integration test for the audit + soft-delete invariants.
//
// Exercises the REAL extended `prisma` client (soft-delete + audit extensions
// composed exactly as lib/prisma.ts composes them) against a REAL local
// Postgres, inside `withAuditContext`. Guards the latent "soft-delete is an
// audit blind spot" bug that had no automated coverage: the contract suite is
// DB-free and never runs the extension query hooks end-to-end.
//
// NOT part of `npm test` -- CI only has a dummy DATABASE_URL. Run it explicitly:
//   npm run test:integration
//     (= node --import tsx --test tests/integration/*.test.ts)
// Load env first:  set -a; . ./.env; set +a
//
// Skips gracefully (does NOT fail) when the DB is unreachable: a trivial probe
// query runs at MODULE LOAD (top-level await) so the per-test `skip` predicate
// -- which node:test evaluates at scheduling time, BEFORE before() hooks run --
// observes the correct value. All rows it creates are cleaned up (hard-deleted
// via prismaUnfiltered) in after().

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";

// Unique marker so cleanup only ever touches rows this run created.
const RUN = `itest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = (label: string) => `${RUN}.${label}@example.test`;

const createdUserIds: string[] = [];

// --- Reachability probe at MODULE LOAD ------------------------------------
// node:test evaluates a test's `skip: () => ...` predicate at scheduling time,
// before any top-level before() hook resolves. So a probe in before() would be
// too late -- the predicate would always read the initial value and every case
// would skip even against a healthy DB. Probing here (top-level await, which
// tsx supports for ESM) sets the flag before any test is registered.
let dbReachable = false;
let actorId: string | undefined;
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  // Seed a real actor row. AuditLog.userId is an FK to User, so attribution
  // must point at a row that exists when the audit rows are written.
  const actor = await prismaUnfiltered.user.create({
    data: { email: email("actor"), name: "Audit Actor", passwordHash: "hash-actor" },
  });
  actorId = actor.id;
  createdUserIds.push(actor.id);
  dbReachable = true;
} catch (err) {
  dbReachable = false;
  console.warn(
    `[audit-softdelete.test] DB unreachable -- skipping all cases: ${
      (err as Error)?.message ?? err
    }`
  );
}

// Attribution the test threads through withAuditContext; asserted on the rows.
const CTX = {
  userId: actorId,
  ipAddress: "198.51.100.42",
  userAgent: "integration-test/audit-softdelete",
};

after(async () => {
  // Hard-delete every audit row + user this run created, via the UNFILTERED
  // client (the extended client would soft-delete + re-audit). Best-effort.
  if (dbReachable) {
    try {
      await prismaUnfiltered.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: "User", entityId: { in: createdUserIds } },
            { userId: { in: createdUserIds } },
          ],
        },
      });
      await prismaUnfiltered.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    } catch {
      // Ignore cleanup failures -- markers make leftover rows identifiable.
    }
  }
  try {
    await prisma.$disconnect();
    await prismaUnfiltered.$disconnect();
  } catch {
    // Ignore.
  }
});

test("CREATE writes one audit row with ip / ua / userId attribution", { skip: !dbReachable }, async () => {
  await withAuditContext(CTX, async () => {
    const user = await prisma.user.create({
      data: { email: email("create"), name: "Create Case", passwordHash: "hash-create" },
    });
    createdUserIds.push(user.id);

    const rows = await prismaUnfiltered.auditLog.findMany({
      where: { entityType: "User", entityId: user.id, action: "CREATE" },
    });
    assert.equal(rows.length, 1, "exactly one CREATE audit row");
    const row = rows[0];
    assert.equal(row.ipAddress, CTX.ipAddress, "ip attributed");
    assert.equal(row.userAgent, CTX.userAgent, "user-agent attributed");
    assert.equal(row.userId, CTX.userId, "userId attributed");
    assert.ok(CTX.userId, "actor seeded (non-null userId)");

    // passwordHash must be scrubbed in the CREATE snapshot.
    const afterSnap = row.after as Record<string, unknown> | null;
    assert.ok(afterSnap, "after snapshot present");
    assert.equal(afterSnap!.passwordHash, "[redacted]", "passwordHash scrubbed in CREATE.after");
    assert.equal(afterSnap!.email, email("create"), "non-restricted field kept verbatim");
  });
});

test(
  "soft-delete (prisma.user.delete) writes a DELETE audit row, sets deletedBy, scrubs passwordHash",
  { skip: !dbReachable },
  async () => {
    await withAuditContext(CTX, async () => {
      const user = await prisma.user.create({
        data: { email: email("delete"), name: "Delete Case", passwordHash: "hash-delete" },
      });
      createdUserIds.push(user.id);

      // The soft-delete extension rewrites delete -> update(deletedAt/deletedBy)
      // on the base client and records the DELETE audit row itself.
      await prisma.user.delete({ where: { id: user.id } });

      // Row is soft-deleted: hidden from the filtered client, visible unfiltered.
      const viaFiltered = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(viaFiltered, null, "soft-deleted user is filtered out of prisma");

      const raw = await prismaUnfiltered.user.findUnique({ where: { id: user.id } });
      assert.ok(raw, "row still physically present (soft delete, not hard delete)");
      assert.ok(raw!.deletedAt, "deletedAt set");
      assert.equal(raw!.deletedBy, CTX.userId, "deletedBy set from audit context");

      const deleteRows = await prismaUnfiltered.auditLog.findMany({
        where: { entityType: "User", entityId: user.id, action: "DELETE" },
      });
      assert.equal(deleteRows.length, 1, "exactly one DELETE audit row for the soft delete");
      const row = deleteRows[0];
      assert.equal(row.ipAddress, CTX.ipAddress, "ip attributed on DELETE");
      assert.equal(row.userAgent, CTX.userAgent, "user-agent attributed on DELETE");
      assert.equal(row.userId, CTX.userId, "userId attributed on DELETE");

      const beforeSnap = row.before as Record<string, unknown> | null;
      assert.ok(beforeSnap, "before snapshot present on DELETE");
      assert.equal(
        beforeSnap!.passwordHash,
        "[redacted]",
        "passwordHash scrubbed in DELETE.before"
      );
    });
  }
);

test(
  "groupBy is soft-delete filtered (the extension intercepts groupBy/aggregate)",
  { skip: !dbReachable },
  async () => {
    // Locks the invariant the dashboard relies on: prisma.user.groupBy excludes
    // soft-deleted rows (SR-H3). The contract suite is DB-free and can't run the
    // extension's query hooks, so this is the only place it is exercised.
    await withAuditContext(CTX, async () => {
      const role = "EDITOR" as const;
      const filteredCount = async () => {
        const g = await prisma.user.groupBy({
          by: ["role"],
          where: { role },
          _count: { _all: true },
        });
        return g[0]?._count._all ?? 0;
      };
      const unfilteredCount = async () => {
        const g = await prismaUnfiltered.user.groupBy({
          by: ["role"],
          where: { role },
          _count: { _all: true },
        });
        return g[0]?._count._all ?? 0;
      };

      const filteredBefore = await filteredCount();
      const unfilteredBefore = await unfilteredCount();

      const user = await prisma.user.create({
        data: {
          email: email("groupby"),
          name: "GroupBy Case",
          passwordHash: "hash-groupby",
          role,
        },
      });
      createdUserIds.push(user.id);

      assert.equal(await filteredCount(), filteredBefore + 1, "live EDITOR counted by groupBy");

      await prisma.user.delete({ where: { id: user.id } });

      assert.equal(
        await filteredCount(),
        filteredBefore,
        "groupBy(prisma) excludes the soft-deleted EDITOR (extension filtered)"
      );
      assert.equal(
        await unfilteredCount(),
        unfilteredBefore + 1,
        "groupBy(prismaUnfiltered) still counts it -- the row is physically present"
      );
    });
  }
);
