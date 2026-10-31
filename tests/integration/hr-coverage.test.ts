// ADR-102: one "who is my HR" model on a real database. JML's case-owner ladder
// (department, then directorate, then company; priority; case types; live,
// active rows only) reads the core coverage rows; HR tickets read the same rows
// through their pair; each half of a row is edited only by its own permission.
//   npm run test:integration
import { test, after, before } from "node:test";
import assert from "node:assert/strict";

import { prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import {
  CoverageForbidden,
  createCoverage,
  updateCoverage,
  removeCoverage,
} from "../../lib/core/hr-coverage/admin";
import { createAssignmentRule, resolveHrAssignment } from "../../lib/jml/engine/assignment";
import { loadHrPairs } from "../../lib/hive/hrtag-source";
import { OrgRuleError } from "../../lib/org/rules";

const RUN = `hcov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let placement: { entityId: string; directorateId: string | null; departmentId: string } | null =
  null;
let teamId: string | null = null;
try {
  const dept = await prismaUnfiltered.department.findFirst({
    where: { deletedAt: null },
    select: {
      id: true,
      entityId: true,
      directorateId: true,
      teams: { select: { id: true }, take: 1 },
    },
  });
  if (dept) {
    placement = {
      entityId: dept.entityId,
      directorateId: dept.directorateId,
      departmentId: dept.id,
    };
    teamId = dept.teams[0]?.id ?? null;
  }
} catch {
  placement = null;
}
const skip = !placement;

const users: Record<string, string> = {};
const roleIds: string[] = [];
const rowIds: string[] = [];
let pairId = "";
const both = { tickets: true, jml: true };
const ticketsOnly = { tickets: true, jml: false };
const jmlOnly = { tickets: false, jml: true };

before(async () => {
  if (skip) return;
  const seats: Record<string, string[]> = {
    owner: ["jml.workTasks"],
    supervisor: ["jml.supervise"],
    owner2: ["jml.workTasks"],
  };
  for (const [label, permissions] of Object.entries(seats)) {
    const u = await prismaUnfiltered.user.create({
      data: { email: `${RUN}.${label}@example.test`, name: `HCOV ${label}`, role: "VIEWER" },
      select: { id: true },
    });
    users[label] = u.id;
    const role = await prismaUnfiltered.accessRole.create({
      data: { name: `${RUN} ${label}`, permissions },
      select: { id: true },
    });
    roleIds.push(role.id);
    await prismaUnfiltered.roleAssignment.create({
      data: { userId: u.id, roleId: role.id, scopeType: "GROUP", note: RUN },
      select: { id: true },
    });
  }
  pairId = (
    await prismaUnfiltered.hrTagPair.create({
      data: { name: `${RUN} pair`, order: 99 },
      select: { id: true },
    })
  ).id;
});

after(async () => {
  if (skip) return;
  await prismaUnfiltered.hrCoverage.deleteMany({ where: { id: { in: rowIds } } });
  await prismaUnfiltered.hrTagPair.deleteMany({ where: { id: pairId } });
  const ids = Object.values(users);
  await prismaUnfiltered.roleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prismaUnfiltered.accessRole.deleteMany({ where: { id: { in: roleIds } } });
  await prismaUnfiltered.user.deleteMany({ where: { id: { in: ids } } });
});

const as = <T>(fn: () => Promise<T>) => withAuditContext({}, fn);
const row = (over: Record<string, unknown>) => ({
  entityId: null,
  directorateId: null,
  departmentId: null,
  teamId: null,
  companyWide: false,
  pairId: null,
  label: "",
  aliases: [],
  ownerUserId: null,
  supervisorUserId: null,
  caseTypes: [] as ("JOIN" | "MOVE" | "LEAVE")[],
  priority: 0,
  active: true,
  ...over,
});
const track = async (p: Promise<{ id: string }>) => {
  const r = await p;
  rowIds.push(r.id);
  return r;
};

test(
  "case owner: the most specific unit wins, then priority; case types and the switch apply",
  { skip },
  async () => {
    const p = placement!;
    const company = await track(
      as(() =>
        createAssignmentRule({
          scope: "COMPANY",
          scopeId: p.entityId,
          priority: 1000,
          active: true,
          caseTypes: [],
          juniorHrUserId: users.owner2,
          seniorHrUserId: users.supervisor,
        }),
      ),
    );
    const dept = await track(
      as(() =>
        createCoverage(
          jmlOnly,
          row({
            departmentId: p.departmentId,
            ownerUserId: users.owner,
            supervisorUserId: users.supervisor,
            caseTypes: ["JOIN", "LEAVE"],
            priority: 1000,
          }),
        ),
      ),
    );
    let hit = await resolveHrAssignment(p, "JOIN");
    assert.equal(hit?.rule.id, dept.id);
    assert.equal(hit?.matchedScope, "DEPARTMENT");
    assert.equal(hit?.rule.scopeId, p.departmentId);
    assert.equal(hit?.rule.juniorHr.id, users.owner);
    // MOVE is not this department row's type: the company row answers.
    hit = await resolveHrAssignment(p, "MOVE");
    assert.equal(hit?.rule.id, company.id);
    assert.equal(hit?.matchedScope, "COMPANY");
    // Switched off, the department row stops owning cases.
    await as(() =>
      updateCoverage(
        jmlOnly,
        dept.id,
        row({
          entityId: p.entityId,
          departmentId: p.departmentId,
          ownerUserId: users.owner,
          supervisorUserId: users.supervisor,
          caseTypes: ["JOIN", "LEAVE"],
          priority: 1000,
          active: false,
        }),
      ),
    );
    assert.notEqual((await resolveHrAssignment(p, "JOIN"))?.rule.id, dept.id);
  },
);

test("each half of a row needs its own permission", { skip }, async () => {
  const p = placement!;
  await assert.rejects(
    as(() =>
      createCoverage(
        ticketsOnly,
        row({
          departmentId: p.departmentId,
          ownerUserId: users.owner,
          supervisorUserId: users.supervisor,
        }),
      ),
    ),
    (e: unknown) => e instanceof CoverageForbidden,
  );
  const ticket = await track(
    as(() =>
      createCoverage(ticketsOnly, row({ entityId: p.entityId, pairId, label: `${RUN} Tech` })),
    ),
  );
  // A JML-only editor may not move a ticket row, rename it, nor delete it.
  await assert.rejects(
    as(() =>
      updateCoverage(
        jmlOnly,
        ticket.id,
        row({ entityId: p.entityId, departmentId: p.departmentId, pairId, label: `${RUN} Tech` }),
      ),
    ),
    (e: unknown) => e instanceof CoverageForbidden,
  );
  await assert.rejects(
    as(() =>
      updateCoverage(jmlOnly, ticket.id, row({ entityId: p.entityId, pairId, label: "Other" })),
    ),
    (e: unknown) => e instanceof CoverageForbidden,
  );
  await assert.rejects(
    as(() => removeCoverage(jmlOnly, ticket.id)),
    (e: unknown) => e instanceof CoverageForbidden,
  );
});

test("tickets read their pair's rows; case rows never route tickets", { skip }, async () => {
  const p = placement!;
  const pair = () => loadHrPairs().then((ps) => ps.find((x) => x.id === pairId));
  const labels = async () => (await pair())?.coverage.map((c) => c.label).sort() ?? [];
  assert.deepEqual(await labels(), [`${RUN} Tech`]);
  const words = await track(
    as(() =>
      createCoverage(
        both,
        row({
          entityId: p.entityId,
          departmentId: p.departmentId,
          pairId,
          label: `${RUN} Data`,
          aliases: ["Analytics"],
          ownerUserId: users.owner,
          supervisorUserId: users.supervisor,
        }),
      ),
    ),
  );
  const got = (await pair())!.coverage.find((c) => c.label === `${RUN} Data`)!;
  assert.deepEqual(got, {
    label: `${RUN} Data`,
    aliases: ["Analytics"],
    companyId: null,
    entityId: p.entityId,
    orgUnitId: p.departmentId,
  });
  // Switched off, it stops routing tickets too.
  await as(() =>
    updateCoverage(
      both,
      words.id,
      row({
        entityId: p.entityId,
        departmentId: p.departmentId,
        pairId,
        label: `${RUN} Data`,
        aliases: ["Analytics"],
        ownerUserId: users.owner,
        supervisorUserId: users.supervisor,
        active: false,
      }),
    ),
  );
  assert.deepEqual(await labels(), [`${RUN} Tech`]);
});

test(
  "the save rules: seats need their permissions; no case seats on a team",
  { skip },
  async () => {
    const p = placement!;
    await assert.rejects(
      as(() =>
        createCoverage(
          jmlOnly,
          row({
            departmentId: p.departmentId,
            ownerUserId: users.supervisor,
            supervisorUserId: users.owner,
          }),
        ),
      ),
      (e: unknown) => e instanceof OrgRuleError && /Work checklist tasks/.test(e.message),
    );
    if (teamId) {
      await assert.rejects(
        as(() =>
          createCoverage(
            jmlOnly,
            row({ teamId, ownerUserId: users.owner, supervisorUserId: users.supervisor }),
          ),
        ),
        (e: unknown) =>
          e instanceof OrgRuleError && /company, directorate or department/.test(e.message),
      );
    }
  },
);
