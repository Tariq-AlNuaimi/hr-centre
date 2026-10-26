import type { NotificationKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { subjectOf } from "../access";
import { notifyJml } from "../engine/notify";

/**
 * Leaver notices into the core feed (the one mechanism — D6), to INTERNAL HR
 * users only (Offboarding AC-18.2 `mayAutoSend`, recipient-first): the case
 * owner and paired senior, optionally the HR managers of the case's scope.
 */

export async function caseRecipients(caseId: string, withManagers = false): Promise<string[]> {
  const kase = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: {
      hrOwnerUserId: true,
      seniorHrUserId: true,
      employee: {
        select: {
          entityId: true,
          departmentId: true,
          department: { select: { directorateId: true } },
        },
      },
    },
  });
  if (!kase) return [];
  const ids = [kase.hrOwnerUserId, kase.seniorHrUserId].filter((x): x is string => Boolean(x));
  if (withManagers) {
    ids.push(
      ...(await usersHoldingPermission("jml.overrideGates", subjectOf(kase.employee), {
        limit: 20,
      })),
    );
  }
  return [...new Set(ids)];
}

export async function noticeToOwners(
  caseId: string,
  kind: NotificationKind,
  body: string,
  dedupeSuffix: string,
  opts: { withManagers?: boolean; extraUserIds?: readonly string[]; now?: Date } = {},
) {
  const userIds = [
    ...(await caseRecipients(caseId, opts.withManagers)),
    ...(opts.extraUserIds ?? []),
  ];
  if (userIds.length === 0) return { written: 0 };
  const now = opts.now ?? new Date();
  return notifyJml(
    [
      {
        kind,
        userIds,
        body,
        href: `/jml/cases/${caseId}`,
        caseId,
        dedupeBase: `${kind}:${caseId}:${dedupeSuffix}`,
      },
    ],
    await loadWorkingCalendar(now),
    now,
  );
}
