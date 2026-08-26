import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadEmployeesFromXlsx } from "./loaders/xlsx";
import { reconcile, type ExistingEmployee, type ReconcileContext } from "./reconcile";
import { validateRows, type ValidationContext } from "./validate";
import { countsFor, planDigest, type ImportPreview, type ValidatedRow } from "./types";
import { decryptSalary, encryptSalary } from "../employee-select";

/**
 * Import orchestration — spec §3.
 *
 * Two entry points, and the split between them is the safety property:
 *
 *   previewImport() — parses, validates, and computes the plan. Writes an
 *                     ImportBatch in PREVIEWED state and its issues. Touches no
 *                     employee row.
 *   applyImport()   — replays a reviewed plan against the employees table.
 *
 * A single-step import would make §3.5's "missing rows → change nothing" a
 * property HR has to trust. Splitting it makes the plan an artifact a human
 * reads and confirms — which is what turns Appendix A's "silence is never
 * destructive" from an assertion into something reviewable before it happens.
 */

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Load the org context both validation and reconciliation need.
 *
 * Three bounded queries, not a query per row. The employee list is the only
 * unbounded one, and it must be complete: §3.5's absent-employee enumeration is
 * defined against every existing employee, so a paginated read would silently
 * mean "these are the people the file did not mention, out of the first page" —
 * a subtly wrong statement on a screen whose whole job is to be trustworthy.
 * The 10,000-row upload cap (loaders/xlsx.ts) bounds the realistic org size, and
 * the select is narrow.
 */
async function loadContext(): Promise<{
  validation: ValidationContext;
  reconcile: ReconcileContext;
}> {
  const [entities, departments, employees] = await Promise.all([
    prisma.orgEntity.findMany({ select: { id: true, code: true, name: true } }),
    prisma.department.findMany({
      select: { id: true, name: true, entityId: true, entity: { select: { code: true } } },
    }),
    prisma.employee.findMany({
      select: {
        id: true,
        odooId: true,
        name: true,
        email: true,
        departmentId: true,
        entityId: true,
        managerId: true,
        roleTrack: true,
        basicSalaryEnc: true,
        status: true,
        dateOfJoining: true,
        lastWorkingDay: true,
        unpaidLeaveDays: true,
      },
    }),
  ]);

  const entitiesByKey = new Map<string, { id: string; code: string }>();
  const entityCodes = new Map<string, string>();
  for (const entity of entities) {
    // Both code and name are accepted keys: HR sheets say "Rihal" as often as
    // "RIHAL", and §1.2 names the entities in prose, not by machine code.
    entitiesByKey.set(normalize(entity.code), { id: entity.id, code: entity.code });
    entitiesByKey.set(normalize(entity.name), { id: entity.id, code: entity.code });
    entityCodes.set(entity.id, entity.code);
  }

  const departmentsByEntityAndName = new Map<string, { id: string; entityId: string }>();
  const departmentsByName = new Map<
    string,
    Array<{ id: string; entityId: string; entityCode: string }>
  >();
  const departmentNames = new Map<string, string>();
  for (const dept of departments) {
    const key = normalize(dept.name);
    departmentsByEntityAndName.set(`${dept.entity.code}::${key}`, {
      id: dept.id,
      entityId: dept.entityId,
    });
    const list = departmentsByName.get(key) ?? [];
    list.push({ id: dept.id, entityId: dept.entityId, entityCode: dept.entity.code });
    departmentsByName.set(key, list);
    departmentNames.set(dept.id, dept.name);
  }

  const existing = new Map<string, ExistingEmployee>();
  for (const employee of employees) {
    existing.set(employee.odooId, {
      id: employee.id,
      odooId: employee.odooId,
      name: employee.name,
      email: employee.email,
      dateOfJoining: employee.dateOfJoining,
      departmentId: employee.departmentId,
      entityId: employee.entityId,
      managerId: employee.managerId,
      roleTrack: employee.roleTrack,
      // ADR-067: decrypt to compare. The reconcile diff needs the VALUE to tell
      // HR that pay changed (`reconcile.ts` then renders it as [redacted]);
      // comparing ciphertexts would report a change on every import, because a
      // fresh IV per write means the same salary never encrypts the same twice.
      basicSalary: decryptSalary(employee.basicSalaryEnc, employee.odooId),
      status: employee.status,
      lastWorkingDay: employee.lastWorkingDay,
      unpaidLeaveDays: employee.unpaidLeaveDays,
    });
  }

  return {
    validation: {
      departmentsByEntityAndName,
      departmentsByName,
      entitiesByKey,
      existingOdooIds: new Set(existing.keys()),
      // Lower-cased to match how checkNameAndEmail normalises the source row;
      // built from the same `employees` read, so this costs no extra query.
      emailOwners: new Map(employees.map((e) => [e.email.trim().toLowerCase(), e.odooId] as const)),
    },
    reconcile: { existing, departmentNames, entityCodes },
  };
}

/**
 * Parse and plan an upload. Writes an ImportBatch in PREVIEWED state; changes
 * no employee.
 */
export async function previewImport(params: {
  buffer: Buffer;
  filename: string;
  userId: string;
  userEmail: string | null;
}): Promise<{ batchId: string; preview: ImportPreview }> {
  const { rows } = await loadEmployeesFromXlsx(params.buffer);
  const ctx = await loadContext();

  const { validRows, issues: validationIssues } = validateRows(rows, ctx.validation);
  const plan = reconcile(validRows, ctx.reconcile);

  const preview: ImportPreview = {
    filename: params.filename,
    rowsTotal: rows.length,
    creates: plan.creates,
    updates: plan.updates,
    absent: plan.absent,
    issues: [...validationIssues, ...plan.issues],
    validRows,
  };

  const counts = countsFor(preview);
  const digest = planDigest(validRows);

  const batch = await prisma.importBatch.create({
    data: {
      filename: params.filename,
      status: "PREVIEWED",
      uploadedById: params.userId,
      uploadedByEmail: params.userEmail,
      ...counts,
      // `validRows` carries salary values and must not be persisted in the
      // preview blob, which is read back by any HR user who can view the batch.
      // Only the human-facing plan is stored; the apply step re-derives the
      // rows from the same file the operator re-submits (see applyImport).
      previewJson: {
        creates: preview.creates,
        updates: preview.updates,
        absent: preview.absent,
        issues: preview.issues,
        // Fingerprint of the rows this plan would WRITE. Persisted here rather
        // than in a column so no migration is needed; re-checked at apply so a
        // different file cannot pass as the reviewed one (see planDigest).
        planDigest: digest,
      } as object,
      issues: {
        create: preview.issues.map((i) => ({
          rowNumber: i.rowNumber,
          odooId: i.odooId,
          field: i.field,
          rule: i.rule,
          message: i.message,
          severity: i.severity,
        })),
      },
    },
    select: { id: true },
  });

  return { batchId: batch.id, preview };
}

/**
 * A confirm that cannot proceed because the world disagrees with the plan — the
 * batch is spent, the org moved, or the file is not the one that was reviewed.
 *
 * Typed rather than matched on message text: the route used to decide 409-vs-500
 * with a regex over the message, which silently mis-classified every new failure
 * mode added afterwards (the digest checks landed as 500s). Every message on this
 * class is written for the operator and is safe to surface.
 */
export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

/** A batch someone else applied while this confirm was in flight. */
export class ImportAlreadyAppliedError extends ImportConflictError {
  constructor() {
    super("This import has already been applied.");
    this.name = "ImportAlreadyAppliedError";
  }
}

/**
 * Apply a previously previewed batch.
 *
 * The same file is re-parsed and re-planned rather than replaying a stored row
 * set, for two reasons. First, `validRows` carries Restricted salary values and
 * is deliberately not persisted (see previewImport). Second, re-planning against
 * live context means an org that changed between preview and apply — a
 * department renamed, an employee added by another admin — is caught rather than
 * overwritten by a stale plan.
 *
 * The freshly computed counts are compared against the reviewed ones, and a
 * divergence aborts: the operator confirmed a specific plan, and applying a
 * different one because the world moved is exactly the surprise the two-step
 * flow exists to prevent.
 */
export async function applyImport(params: {
  batchId: string;
  buffer: Buffer;
}): Promise<{ created: number; updated: number; provisioned: number }> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: params.batchId },
    select: {
      id: true,
      status: true,
      rowsCreated: true,
      rowsUpdated: true,
      rowsRejected: true,
      previewJson: true,
    },
  });
  if (!batch) throw new Error("Import batch not found");
  if (batch.status !== "PREVIEWED") {
    throw new ImportConflictError(
      `Import batch is ${batch.status}; only a PREVIEWED batch can be applied.`,
    );
  }

  const { rows } = await loadEmployeesFromXlsx(params.buffer);
  const ctx = await loadContext();
  const { validRows, issues: validationIssues } = validateRows(rows, ctx.validation);
  const plan = reconcile(validRows, ctx.reconcile);

  const fresh = countsFor({
    filename: "",
    rowsTotal: rows.length,
    creates: plan.creates,
    updates: plan.updates,
    absent: plan.absent,
    issues: [...validationIssues, ...plan.issues],
    validRows,
  });

  if (
    fresh.rowsCreated !== batch.rowsCreated ||
    fresh.rowsUpdated !== batch.rowsUpdated ||
    fresh.rowsRejected !== batch.rowsRejected
  ) {
    throw new ImportConflictError(
      "The organization changed since this preview was generated, so the plan no longer " +
        "matches what was reviewed. Upload the file again to get a fresh preview.",
    );
  }

  // The counts above catch the org moving underneath a plan — another admin
  // adding someone turns a create into an update. They do NOT catch a different
  // FILE: two sheets with one create each produce identical counts while writing
  // entirely different people. The digest is what makes "confirm exactly what
  // you reviewed" true rather than aspirational.
  const reviewedDigest =
    batch.previewJson && typeof batch.previewJson === "object" && !Array.isArray(batch.previewJson)
      ? (batch.previewJson as Record<string, unknown>).planDigest
      : undefined;

  if (typeof reviewedDigest !== "string") {
    // A batch previewed before digests existed. Refusing is the conservative
    // read: this batch cannot be shown to match what was reviewed, and a fresh
    // preview costs one upload.
    throw new ImportConflictError(
      "This preview predates content verification and cannot be confirmed. " +
        "Upload the file again to get a fresh preview.",
    );
  }

  if (planDigest(validRows) !== reviewedDigest) {
    throw new ImportConflictError(
      "The file submitted for confirmation is not the one that was previewed — its contents " +
        "differ from the plan that was reviewed. Upload it again to get a fresh preview.",
    );
  }

  const byOdooId = new Map(validRows.map((r) => [r.odooId, r]));

  // Counted rather than derived from `plan.creates.length`: provisioning SKIPS a
  // leaver and skips an email that already has a login, so the two numbers are
  // legitimately different and HR is told the one that happened.
  let provisioned = 0;

  /*
    An EXPLICIT budget, because Prisma's default one is 5 seconds and this
    transaction is the largest write the product makes.

    Measured on a loopback Postgres: ~3.4 ms per created row. Neon is a network
    away and will be several times that. The default 5 s therefore runs out around
    a thousand rows locally and far fewer in production — while the loader accepts
    MAX_ROWS = 10,000. A ceiling nobody chose, discovered as a P2028 rollback
    halfway through onboarding a company, is the worst version of this.

    Atomicity is not negotiable here (Appendix A: silence is never destructive;
    §3.5's all-or-nothing is what makes the preview meaningful), so the answer is
    a bigger budget, not a split into chunks that can half-apply.

    The REAL ceiling is the serverless function's own duration limit, which is
    shorter than this on Vercel's smaller plans and is not something the code can
    set from here — `maxDuration` in vercel.json is the lever, and raising it
    needs a plan that allows it. Written down in docs/findings-register.md rather
    than left for a first import to find.
  */
  const rowsTouched = plan.creates.length + plan.updates.length;
  await auditedTransaction(async (tx) => {
    // Claim the batch BEFORE writing anything.
    //
    // The status check above is a read, so two confirms racing each other both
    // pass it. Flipping the status at the END of the transaction (where this
    // used to live) left the whole write window open: both transactions ran the
    // creates, and the loser died on a raw unique-constraint violation that
    // reached the operator as an opaque 500 with a stack trace in it.
    //
    // A conditional update makes the flip the point of contention instead. The
    // second transaction blocks on this row until the first commits, then
    // matches nothing and throws P2025 before touching an employee. Prisma's
    // extended `where` keeps this a single-row update, so it still audits like
    // one (no bulk-write escape hatch).
    try {
      await tx.importBatch.update({
        where: { id: batch.id, status: "PREVIEWED" },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
    } catch {
      throw new ImportAlreadyAppliedError();
    }

    // Pass 1 — creates and updates WITHOUT manager links.
    //
    //
    // A file may name a manager who is created by the same file, and Postgres
    // enforces the self-referencing FK per statement. Writing the rows first and
    // the edges second is what lets an org sheet arrive in any order, which
    // matters because HR sorts by department or name, never topologically.
    // ADR-069 — which of these emails already has an account, asked ONCE for the
    // whole batch. Per-row it was an N+1 inside a transaction that has a deadline.
    const taken = await existingLoginEmails(
      tx,
      plan.creates.map((c) => byOdooId.get(c.odooId)?.email ?? "").filter(Boolean),
    );

    for (const create of plan.creates) {
      const row = byOdooId.get(create.odooId);
      if (!row) continue;
      const userId = await provisionLoginFor(tx, row, taken);
      if (userId) provisioned++;
      await tx.employee.create({
        data: {
          odooId: row.odooId,
          name: row.name,
          email: row.email,
          departmentId: row.departmentId,
          entityId: row.entityId,
          roleTrack: row.roleTrack,
          basicSalaryEnc: encryptSalary(row.basicSalary, row.odooId),
          status: row.status,
          dateOfJoining: row.dateOfJoining,
          lastWorkingDay: row.lastWorkingDay,
          unpaidLeaveDays: row.unpaidLeaveDays,
          // The link on the CREATE, not a second statement after it.
          userId,
        },
        select: { id: true },
      });
    }

    for (const update of plan.updates) {
      const row = byOdooId.get(update.odooId);
      if (!row) continue;
      await tx.employee.update({
        where: { id: update.employeeId },
        data: {
          name: row.name,
          email: row.email,
          departmentId: row.departmentId,
          entityId: row.entityId,
          roleTrack: row.roleTrack,
          basicSalaryEnc: encryptSalary(row.basicSalary, row.odooId),
          status: row.status,
          dateOfJoining: row.dateOfJoining,
          lastWorkingDay: row.lastWorkingDay,
          unpaidLeaveDays: row.unpaidLeaveDays,
        },
      });
    }

    // Pass 2 — manager edges, now that every referenced row exists.
    const touched = [...plan.creates.map((c) => c.odooId), ...plan.updates.map((u) => u.odooId)];
    if (touched.length > 0) {
      const resolved = await tx.employee.findMany({
        where: { odooId: { in: [...new Set([...touched, ...collectManagerIds(validRows)])] } },
        select: { id: true, odooId: true, managerId: true },
      });
      const idByOdooId = new Map(resolved.map((e) => [e.odooId, e.id]));
      const currentManager = new Map(resolved.map((e) => [e.odooId, e.managerId]));

      for (const odooId of touched) {
        const row = byOdooId.get(odooId);
        const employeeId = idByOdooId.get(odooId);
        if (!row || !employeeId) continue;

        const managerId = row.managerOdooId ? (idByOdooId.get(row.managerOdooId) ?? null) : null;
        // Skip a no-op write: an unchanged manager must not produce an audit row
        // claiming the reporting line moved.
        if (currentManager.get(odooId) === managerId) continue;

        await tx.employee.update({ where: { id: employeeId }, data: { managerId } });
      }
    }
  }, APPLY_TX_BUDGET(rowsTouched));

  return { created: plan.creates.length, updated: plan.updates.length, provisioned };
}

/**
 * Give a newly-imported employee a way in — ADR-069.
 *
 * §3.3 lists Email "for login/notifications", and §4.4's My Tasks, §9.7's rater
 * invitations and §13.1's scorecard are all addressed to a person. Until this
 * existed, the only writers of a `User` row were the bootstrap seed and
 * `POST /api/users` one person at a time, so applying an import produced
 * thirty-six employees who could not sign in. The 2026-08-25 conformance report's
 * "every screen-run was an HR Super Admin" was that gap showing through: nobody
 * else COULD run a screen.
 *
 * Four decisions, each of which is a thing this deliberately does NOT do:
 *
 *   1. **No password.** `passwordHash` is left null, not set to a random string.
 *      `authorize()` already returns null for an account with no hash (and counts
 *      the attempt toward the lockout), so a null hash makes credentials sign-in
 *      IMPOSSIBLE for these accounts rather than weakly possible. A random
 *      password would be a real secret that could be reset, leaked or logged, in
 *      exchange for nothing — nobody would ever be told it.
 *   2. **`VIEWER`, never `ADMIN`.** `User.role` governs PLATFORM administration
 *      (`withAdminAuth`: users, recycling bin, audit log); §4.1's HR authority
 *      lives on `Employee.pmsRoles` and comes from `/admin/roles`. Appearing in an
 *      HR spreadsheet must never mint a platform administrator, so the import is
 *      not a second, quieter way to become one.
 *   3. **No leaver.** §12.1 preserves a leaver's record and history, not their
 *      access. Minting a login for someone who has left is the opposite of what an
 *      off-boarding step does.
 *   4. **Never overwrites.** An email that already has a `User` is left entirely
 *      alone — no password reset, no role change, no relink. A re-import runs
 *      every week (§3.5) and must not disturb anyone who is already signed up.
 *
 * The link is written HERE rather than left to `resolveActor`'s first-login email
 * match. That fallback still exists and still works, but a link made at creation
 * is one that cannot be raced, and it means `userId` is authoritative from the
 * first request rather than the second.
 *
 * Runs inside the apply transaction, so a failed import provisions nobody.
 */
/*
   Both exported for the ADR-069 integration test: the rule is worth asserting
   against the SHIPPED functions rather than a copy of them in a fixture. Not part
   of the module's public surface — nothing else imports them.
*/

/**
 * The apply transaction's time budget, scaled to the plan — see the note at its
 * use site. Floors at 30 s so a small import is never tighter than the default it
 * replaces, and allows 40 ms per touched row, which is roughly four times the
 * measured loopback cost so a network round trip has room.
 */
function APPLY_TX_BUDGET(rowsTouched: number): { timeout: number; maxWait: number } {
  return { timeout: Math.max(30_000, rowsTouched * 40), maxWait: 15_000 };
}

/** Chunk size for the `email IN (...)` lookups. A batch may be 10,000 rows. */
const EMAIL_LOOKUP_CHUNK = 1_000;

/**
 * Every email in `emails` that ALREADY has a `User` — live or soft-deleted.
 *
 * TWO queries per chunk, because the unique email index does not respect the
 * soft-delete filter and this set has to see everything the index sees. The
 * extension injects `deletedAt: null` into every read unless the caller names
 * `deletedAt` itself, so a live account and an off-boarded one are two different
 * questions. Asking only the first would report "no account" for a revoked one —
 * and the `create` that followed would hit the unique index and roll back the
 * WHOLE import, not just that row.
 *
 * (`prismaUnfiltered` would answer both at once and is exactly what the
 * `no-prisma-unfiltered-import` floor rule refuses outside auth and the recycling
 * bin. It is right to refuse; two indexed reads per chunk cost nothing.)
 *
 * Resolved ONCE for the whole batch rather than per row. The per-row version this
 * replaces was an N+1 inside the apply transaction, and the apply transaction has
 * a deadline: measured on a loopback Postgres it took the cost of a created row
 * from 3.4 ms to 9.6 ms, which moved the point where Prisma's default 5 s budget
 * runs out from ~1,480 rows to ~520 — under the 10,000 the loader accepts.
 */
export async function existingLoginEmails(
  tx: Parameters<Parameters<typeof auditedTransaction>[0]>[0],
  emails: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  const taken = new Set<string>();
  for (let i = 0; i < wanted.length; i += EMAIL_LOOKUP_CHUNK) {
    const chunk = wanted.slice(i, i + EMAIL_LOOKUP_CHUNK);
    const [live, revoked] = await Promise.all([
      tx.user.findMany({ where: { email: { in: chunk } }, select: { email: true } }),
      tx.user.findMany({
        where: { email: { in: chunk }, deletedAt: { not: null } },
        select: { email: true },
      }),
    ]);
    for (const u of [...live, ...revoked]) taken.add(u.email.toLowerCase());
  }
  return taken;
}

/**
 * Give a newly-imported employee a way in — ADR-069. Returns the new `User`'s id,
 * to be written as `userId` on the employee row being created, or null when this
 * person gets no login.
 *
 * §3.3 lists Email "for login/notifications", and §4.4's My Tasks, §9.7's rater
 * invitations and §13.1's scorecard are all addressed to a person. Until this
 * existed, the only writers of a `User` row were the bootstrap seed and
 * `POST /api/users` one person at a time, so applying an import produced
 * thirty-six employees who could not sign in. The 2026-08-25 conformance report's
 * "every screen-run was an HR Super Admin" was that gap showing through: nobody
 * else COULD run a screen.
 *
 * Four decisions, each of which is a thing this deliberately does NOT do:
 *
 *   1. **No password.** `passwordHash` is left null, not set to a random string.
 *      `authorize()` already returns null for an account with no hash (and counts
 *      the attempt toward the lockout), so a null hash makes credentials sign-in
 *      IMPOSSIBLE for these accounts rather than weakly possible. A random
 *      password would be a real secret that could be reset, leaked or logged, in
 *      exchange for nothing — nobody would ever be told it.
 *   2. **`VIEWER`, never `ADMIN`.** `User.role` governs PLATFORM administration
 *      (`withAdminAuth`: users, recycling bin, audit log); §4.1's HR authority
 *      lives on `Employee.pmsRoles` and comes from `/admin/roles`. Appearing in an
 *      HR spreadsheet must never mint a platform administrator, so the import is
 *      not a second, quieter way to become one.
 *   3. **No leaver.** §12.1 preserves a leaver's record and history, not their
 *      access. Minting a login for someone who has left is the opposite of what an
 *      off-boarding step does.
 *   4. **Never overwrites, never resurrects.** An email already in `taken` is left
 *      entirely alone — no password reset, no role change, no relink, and no
 *      un-deleting. A re-import runs every week (§3.5) and must not disturb anyone
 *      already signed up; a soft-deleted account is access somebody deliberately
 *      revoked, and a re-hire appearing in a spreadsheet is not the undoing of it.
 *      Restoring is the recycling bin's job, done by a person.
 *
 * The link is written as `userId` on the employee's own CREATE rather than as a
 * follow-up update — one statement instead of two, on the hottest loop in the
 * product — and rather than left to `resolveActor`'s first-login email match. That
 * fallback still exists and still works, but a link made at creation cannot be
 * raced, and `userId` is authoritative from the first request rather than the
 * second.
 *
 * `taken` is MUTATED on success, so two rows in one file sharing an email cannot
 * both mint an account. §3.4 already rejects duplicate emails at validation; this
 * is the belt to that pair of braces, and it costs one Set insert.
 *
 * Runs inside the apply transaction, so a failed import provisions nobody.
 */
export async function provisionLoginFor(
  tx: Parameters<Parameters<typeof auditedTransaction>[0]>[0],
  row: { email: string; name: string; status: string },
  taken: Set<string>,
): Promise<string | null> {
  if (row.status === "LEAVER") return null;

  const email = row.email.toLowerCase().trim();
  if (taken.has(email)) return null;

  const user = await tx.user.create({
    data: { email, name: row.name, role: "VIEWER" },
    select: { id: true },
  });
  taken.add(email);
  return user.id;
}

/** Manager odooIds referenced by the batch, so pass 2 can resolve them all. */
function collectManagerIds(rows: ValidatedRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) if (row.managerOdooId) ids.push(row.managerOdooId);
  return ids;
}
