// QA run 2 N-07 — the grade catalogue on a real database: one code per company,
// and a grade in use cannot be deleted from under its users. Own data under a
// unique run key, so re-runs on the same DB are independent.
//   npm run test:integration
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

import { prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import { resolveHiringActor } from "../../lib/hiring/actor";
import { HiringRuleError } from "../../lib/hiring/http";
import { createLibraryItem, deleteLibraryItem } from "../../lib/hiring/library";

const RUN = `GQ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
let actor: Awaited<ReturnType<typeof resolveHiringActor>> | null = null;
let entityId = "";
const created: string[] = [];

try {
  const admin = await prismaUnfiltered.user.findFirst({
    where: { email: "admin@example.com" },
    select: { id: true, email: true },
  });
  const entity = await prismaUnfiltered.orgEntity.findFirst({ select: { id: true } });
  if (admin && entity) {
    entityId = entity.id;
    actor = await resolveHiringActor({
      user: { id: admin.id, email: admin.email, role: "ADMIN" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    } as Session);
  }
} catch {
  actor = null;
}
const skip = !actor;

async function status(fn: () => Promise<unknown>): Promise<number> {
  try {
    await withAuditContext({}, fn);
    return 200;
  } catch (e) {
    if (e instanceof HiringRuleError) return e.status;
    throw e;
  }
}

before(async () => {
  if (skip) return;
  const g = (await withAuditContext({}, () =>
    createLibraryItem(actor!, "grades", { code: RUN, name: `${RUN} grade`, entityId, order: 99 }),
  )) as { id: string };
  created.push(g.id);
});

after(async () => {
  if (skip) return;
  await prismaUnfiltered.hiringJdTemplate.deleteMany({ where: { title: { startsWith: RUN } } });
  await prismaUnfiltered.grade.deleteMany({ where: { code: { startsWith: RUN } } });
});

test(
  "N-07 a duplicate grade code in the same company is refused (case-insensitive)",
  { skip },
  async () => {
    const dup = () =>
      createLibraryItem(actor!, "grades", {
        code: RUN.toLowerCase(),
        name: "Again",
        entityId,
        order: 1,
      });
    assert.equal(await status(dup), 409);
    assert.equal(await prismaUnfiltered.grade.count({ where: { code: { startsWith: RUN } } }), 1);
  },
);

test(
  "N-07 a grade used by a JD template cannot be deleted; an unused one can",
  { skip },
  async () => {
    await prismaUnfiltered.hiringJdTemplate.create({
      data: { title: `${RUN} template`, description: "x", competencies: [], grade: RUN },
      select: { id: true },
    });
    assert.equal(await status(() => deleteLibraryItem(actor!, "grades", created[0])), 409);
    await prismaUnfiltered.hiringJdTemplate.deleteMany({ where: { title: { startsWith: RUN } } });
    assert.equal(await status(() => deleteLibraryItem(actor!, "grades", created[0])), 200);
  },
);
