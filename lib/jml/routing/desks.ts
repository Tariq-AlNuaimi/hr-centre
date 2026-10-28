import type { JmlTaskDesk } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { DeskSettingsInput } from "@/lib/validations/jml/routing";
import { JmlError } from "../errors";
import { TASK_DESKS } from "./rules";

/**
 * The IT and Finance desks (Admin › Settings › Joiners & leavers › Task
 * routing): named people, several per desk. Membership is what lets a non-HR
 * user see and complete that desk's tasks (lib/jml/routing/rules.ts).
 *
 * A deleted login drops out (cascade on the row, and every read filters
 * `deletedAt`), so a desk never routes to someone who cannot sign in.
 */

const MEMBER_LIMIT = 50;
const CANDIDATE_LIMIT = 500;

const ACTIVE_USER = { deletedAt: null } as const;

type DeskUser = { id: string; name: string | null; email: string };

/** Each desk's current members, plus the users HR may pick from. */
export async function getDeskSettings() {
  const [rows, candidates] = await Promise.all([
    prisma.jmlDeskMember.findMany({
      where: { user: ACTIVE_USER },
      orderBy: { createdAt: "asc" },
      take: MEMBER_LIMIT * TASK_DESKS.length,
      select: { desk: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.user.findMany({
      where: ACTIVE_USER,
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: CANDIDATE_LIMIT,
      select: { id: true, name: true, email: true },
    }),
  ]);
  const desks: Record<JmlTaskDesk, DeskUser[]> = { IT: [], FINANCE: [] };
  for (const r of rows) desks[r.desk].push(r.user);
  return { desks, candidates };
}

/** Replace both desks' member lists (find-then-write per row: audited). */
export async function saveDeskSettings(input: DeskSettingsInput) {
  const wanted = new Set(TASK_DESKS.flatMap((d) => input[d]));
  const found = await prisma.user.findMany({
    where: { id: { in: [...wanted] }, ...ACTIVE_USER },
    select: { id: true },
    take: wanted.size,
  });
  if (found.length !== wanted.size) {
    throw new JmlError(
      "One of the selected people no longer has a login. Reload and try again.",
      422,
    );
  }
  await auditedTransaction(async (tx) => {
    const current = await tx.jmlDeskMember.findMany({
      select: { id: true, desk: true, userId: true },
      take: 1000,
    });
    for (const desk of TASK_DESKS) {
      const keep = new Set(input[desk]);
      for (const row of current.filter((r) => r.desk === desk && !keep.has(r.userId))) {
        await tx.jmlDeskMember.delete({ where: { id: row.id } });
      }
      const have = new Set(current.filter((r) => r.desk === desk).map((r) => r.userId));
      for (const userId of input[desk].filter((id) => !have.has(id))) {
        await tx.jmlDeskMember.create({ data: { desk, userId }, select: { id: true } });
      }
    }
  });
  return getDeskSettings();
}

/** The desks a user is listed on (one indexed read per request). */
export async function desksOf(userId: string): Promise<Set<JmlTaskDesk>> {
  const rows = await prisma.jmlDeskMember.findMany({
    where: { userId },
    select: { desk: true },
    take: TASK_DESKS.length,
  });
  return new Set(rows.map((r) => r.desk));
}

/** Members of each desk (active logins), for routing and notices. */
export async function deskMembers(): Promise<Record<JmlTaskDesk, string[]>> {
  const rows = await prisma.jmlDeskMember.findMany({
    where: { user: ACTIVE_USER },
    select: { desk: true, userId: true },
    take: MEMBER_LIMIT * TASK_DESKS.length,
  });
  const out: Record<JmlTaskDesk, string[]> = { IT: [], FINANCE: [] };
  for (const r of rows) out[r.desk].push(r.userId);
  return out;
}

export function staffedDesks(members: Record<JmlTaskDesk, string[]>): Set<JmlTaskDesk> {
  return new Set(TASK_DESKS.filter((d) => members[d].length > 0));
}
