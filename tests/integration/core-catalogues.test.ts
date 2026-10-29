// ADR-097: Employee.gradeId follows Employee.grade on every write (database
// trigger), the company's own grade wins over a group-wide one, and adding a
// grade to the catalogue links employees who already hold it. Run with
//   npm run test:integration
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { prismaUnfiltered } from "../../lib/prisma";
import { relinkEmployeeGrades } from "../../lib/core/catalogue/grades";
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

async function employee(label: string, g: string | null) {
  const e = await prismaUnfiltered.employee.create({
    data: {
      odooId: `${TEST_EMPLOYEE_PREFIX}${RUN}-${label}`.slice(0, 60),
      name: `CG ${label}`,
      email: `${RUN}.${label}@example.test`,
      entityId,
      departmentId,
      roleTrack: "INDIVIDUAL",
      grade: g,
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

test(
  "a write links the grade; the company's own grade beats a group-wide one",
  { skip: !dbReachable },
  async () => {
    const groupWide = await grade(code("g7"), null);
    const own = await grade(code("g7"), entityId);
    const e = await employee("a", ` ${code("g7").toLowerCase()} `);
    assert.equal(await gradeIdOf(e), own, "case and spacing are ignored; the company's grade wins");
    await prismaUnfiltered.grade.update({ where: { id: own }, data: { deletedAt: new Date() } });
    await prismaUnfiltered.employee.update({ where: { id: e }, data: { grade: code("g7") } });
    assert.equal(await gradeIdOf(e), groupWide, "a removed grade falls back to the group-wide one");
  },
);

test("changing or clearing the grade moves or drops the link", { skip: !dbReachable }, async () => {
  const g8 = await grade(code("g8"), entityId);
  const e = await employee("b", null);
  assert.equal(await gradeIdOf(e), null);
  await prismaUnfiltered.employee.update({ where: { id: e }, data: { grade: code("g8") } });
  assert.equal(await gradeIdOf(e), g8);
  await prismaUnfiltered.employee.update({ where: { id: e }, data: { grade: null } });
  assert.equal(await gradeIdOf(e), null);
});

test(
  "a grade added to the catalogue later links the people who hold it",
  { skip: !dbReachable },
  async () => {
    const e = await employee("c", code("g9"));
    assert.equal(await gradeIdOf(e), null, "unknown to the catalogue: kept as written, unlinked");
    const g9 = await grade(code("g9"), entityId);
    await relinkEmployeeGrades([code("g9")]);
    assert.equal(await gradeIdOf(e), g9);
  },
);
