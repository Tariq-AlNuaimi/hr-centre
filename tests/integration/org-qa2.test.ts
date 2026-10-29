// QA run 2 — org structure worst paths on a real database (N-05, N-06).
// Own data under a unique run key, so re-runs on the same DB are independent.
//   npm run test:integration
import { test, after, before } from "node:test";
import assert from "node:assert/strict";

import { prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import { scheduleOrgChange } from "../../lib/org/changes";
import { setUnitHead } from "../../lib/org/heads";
import { OrgRuleError } from "../../lib/org/rules";
import { scheduleOrgChangeSchema } from "../../lib/validations/org";
import { TEST_EMPLOYEE_PREFIX } from "./fixture";

const RUN = `oq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let dbReachable = false;
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  dbReachable = (await prismaUnfiltered.orgEntity.count()) >= 2;
} catch {
  dbReachable = false;
}

const ids: Record<string, string> = {};
const ymd = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await withAuditContext({}, () => p);
    return 200;
  } catch (e) {
    if (e instanceof OrgRuleError) return e.status;
    throw e;
  }
}
const run = <T>(fn: () => Promise<T>) => withAuditContext({}, fn);

before(async () => {
  if (!dbReachable) return;
  const [a, b] = await prismaUnfiltered.orgEntity.findMany({
    take: 2,
    orderBy: { code: "asc" },
    select: { id: true },
  });
  ids.a = a.id;
  ids.b = b.id;
  ids.dirA = (
    await prismaUnfiltered.directorate.create({
      data: { name: `${RUN} Dir`, entityId: a.id },
      select: { id: true },
    })
  ).id;
  const dept = async (name: string, entityId: string) =>
    (
      await prismaUnfiltered.department.create({
        data: { name: `${RUN} ${name}`, entityId },
        select: { id: true },
      })
    ).id;
  ids.alpha = await dept("Alpha", a.id);
  ids.beta = await dept("Beta", a.id);
  ids.other = await dept("Other", b.id);
  const emp = async (label: string, entityId: string, departmentId: string) =>
    (
      await prismaUnfiltered.employee.create({
        data: {
          odooId: `${TEST_EMPLOYEE_PREFIX}${RUN}-${label}`.slice(0, 60),
          name: `OQ ${label}`,
          email: `${RUN}.${label}@example.test`,
          entityId,
          departmentId,
          roleTrack: "INDIVIDUAL",
          status: "ACTIVE",
        },
        select: { id: true },
      })
    ).id;
  ids.empA = await emp("a", a.id, ids.alpha);
  ids.empB = await emp("b", b.id, ids.other);
});

after(async () => {
  if (!dbReachable) return;
  const units = [ids.dirA, ids.alpha, ids.beta, ids.other].filter(Boolean);
  await prismaUnfiltered.orgUnitChange.deleteMany({ where: { unitId: { in: units } } });
  await prismaUnfiltered.employee.deleteMany({ where: { id: { in: [ids.empA, ids.empB] } } });
  await prismaUnfiltered.department.deleteMany({ where: { name: { startsWith: RUN } } });
  await prismaUnfiltered.directorate.deleteMany({ where: { name: { startsWith: RUN } } });
});

test("N-05 an impossible date (2026-02-30) is refused at the boundary, not rolled to March", () => {
  const r = scheduleOrgChangeSchema.safeParse({
    unitKind: "DEPARTMENT",
    unitId: "d1",
    effectiveDate: "2026-02-30",
    newName: "X",
  });
  assert.equal(r.success, false);
});

test("N-05 a past date needs HR's explicit 'apply now'", { skip: !dbReachable }, async () => {
  const past = { unitKind: "DEPARTMENT" as const, unitId: ids.alpha, effectiveDate: ymd(-3) };
  assert.equal(await status(scheduleOrgChange({ ...past, newName: `${RUN} Alpha2` }, null)), 400);
  const applied = await run(() =>
    scheduleOrgChange({ ...past, newName: `${RUN} Alpha2`, applyNow: true }, null),
  );
  assert.equal(applied.status, "APPLIED");
});

test(
  "N-05 cross-company moves and duplicate names are refused at REQUEST time",
  { skip: !dbReachable },
  async () => {
    const future = { unitKind: "DEPARTMENT" as const, effectiveDate: ymd(10) };
    assert.equal(
      await status(
        scheduleOrgChange({ ...future, unitId: ids.other, newParentId: ids.dirA }, null),
      ),
      400,
      "a department under another company's directorate",
    );
    assert.equal(
      await status(
        scheduleOrgChange({ ...future, unitId: ids.beta, newName: `${RUN} Alpha2` }, null),
      ),
      409,
      "a rename onto a name the company already uses",
    );
    assert.equal(
      await prismaUnfiltered.orgUnitChange.count({
        where: { unitId: { in: [ids.other, ids.beta] } },
      }),
      0,
      "nothing was scheduled",
    );
    assert.equal(
      await status(
        scheduleOrgChange(
          { ...future, unitId: ids.beta, effectiveDate: ymd(365 * 3), newName: "Later" },
          null,
        ),
      ),
      400,
      "more than two years ahead",
    );
  },
);

test(
  "N-06 a unit head must be an employee of the unit's own company",
  { skip: !dbReachable },
  async () => {
    assert.equal(
      await status(setUnitHead({ kind: "DEPARTMENT", unitId: ids.beta, headEmployeeId: ids.empB })),
      400,
    );
    const ok = await run(() =>
      setUnitHead({ kind: "DEPARTMENT", unitId: ids.beta, headEmployeeId: ids.empA }),
    );
    assert.equal(ok.head?.id, ids.empA);
  },
);
