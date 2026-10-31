// ADR-097 / ADR-103: an employee's grade is a core catalogue row. Writers hand
// over a CODE: the company's own grade wins over a group-wide one, case and
// spacing are ignored, a removed grade falls back to the group-wide one, and an
// unknown code is refused with a readable reason. Run with
//   npm run test:integration
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { prismaUnfiltered } from "../../lib/prisma";
import { resolveGradeCode } from "../../lib/core/catalogue/grades";
import { updateEmployeeRecord } from "../../lib/people/service";
import { withAuditContext } from "../../lib/audit-context";
import { OrgRuleError } from "../../lib/org/rules";
import { TEST_EMPLOYEE_PREFIX } from "./fixture";

const RUN = `cg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let dbReachable = false;
let entityId = "";
let departmentId = "";
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  const d = await prismaUnfiltered.department.findFirstOrThrow({
    select: { id: true, entityId: true },
  });
  departmentId = d.id;
  entityId = d.entityId;
  dbReachable = true;
} catch {
  dbReachable = false;
}

const grades: string[] = [];
const employees: string[] = [];
const code = (s: string) => `${RUN}-${s}`.toUpperCase();

async function grade(c: string, entity: string | null) {
  const g = await prismaUnfiltered.grade.create({
    data: { code: c, name: c, entityId: entity },
    select: { id: true },
  });
  grades.push(g.id);
  return g.id;
}

async function employee(label: string) {
  const e = await prismaUnfiltered.employee.create({
    data: {
      odooId: `${TEST_EMPLOYEE_PREFIX}${RUN}-${label}`.slice(0, 60),
      name: `CG ${label}`,
      email: `${RUN}.${label}@example.test`,
      entityId,
      departmentId,
      roleTrack: "INDIVIDUAL",
    },
    select: { id: true },
  });
  employees.push(e.id);
  return e.id;
}

const gradeIdOf = async (id: string) =>
  (await prismaUnfiltered.employee.findUniqueOrThrow({ where: { id }, select: { gradeId: true } }))
    .gradeId;

after(async () => {
  if (!dbReachable) return;
  await prismaUnfiltered.employee.deleteMany({ where: { id: { in: employees } } });
  await prismaUnfiltered.grade.deleteMany({ where: { id: { in: grades } } });
});

const setGrade = (id: string, g: string | null) =>
  withAuditContext({}, () => updateEmployeeRecord(id, { grade: g }));

test(
  "a code resolves to the company's own grade first; case and spacing are ignored",
  { skip: !dbReachable },
  async () => {
    const groupWide = await grade(code("g7"), null);
    const own = await grade(code("g7"), entityId);
    const e = await employee("a");
    await setGrade(e, ` ${code("g7").toLowerCase()} `);
    assert.equal(await gradeIdOf(e), own);
    await prismaUnfiltered.grade.update({ where: { id: own }, data: { deletedAt: new Date() } });
    await setGrade(e, code("g7"));
    assert.equal(await gradeIdOf(e), groupWide, "a removed grade falls back to the group-wide one");
    await setGrade(e, null);
    assert.equal(await gradeIdOf(e), null, "clearing the grade drops the link");
  },
);

test(
  "an unknown code is refused with the codes that would be accepted",
  { skip: !dbReachable },
  async () => {
    await grade(code("g8"), entityId);
    const e = await employee("b");
    await assert.rejects(
      setGrade(e, code("nope")),
      (err: unknown) =>
        err instanceof OrgRuleError &&
        err.status === 400 &&
        /^grade: Grade ".+" is not in the grade catalogue for .+\. Use one of: .*G8/i.test(
          err.message,
        ),
    );
    assert.equal(await gradeIdOf(e), null, "nothing written");
    const r = await resolveGradeCode(code("g8"), entityId);
    assert.ok(!("problem" in r) && r.code === code("g8"));
  },
);
