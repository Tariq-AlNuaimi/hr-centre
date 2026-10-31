import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { paginatedResponse, type PaginationParams } from "@/lib/pagination";

/**
 * Admin › Email log (ADR-095 follow-up): every module's sent, queued and failed
 * emails in one list. Metadata only — the log never stores a body, and the
 * list returns no case content: module, type, recipient, subject, status, when,
 * the failure reason, who resent it.
 */

/** Modules whose emails can be sent again from the log (their sender keeps a queue). */
const RESENDABLE_MODULES = new Set(["jml"]);
/** Statuses a resend makes sense for: never an email that already went. */
const RESENDABLE_STATUSES = new Set(["FAILED", "CANCELLED", "QUEUED"]);

export type EmailLogFilter = {
  module?: string;
  status?: "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  from?: Date;
  to?: Date;
};

const LOG_SELECT = {
  id: true,
  module: true,
  type: true,
  recipient: true,
  cc: true,
  subject: true,
  status: true,
  scheduledFor: true,
  sentAt: true,
  failureReason: true,
  resendOfId: true,
  createdAt: true,
  sentBy: { select: { name: true, email: true } },
  _count: { select: { resends: true } },
} as const satisfies Prisma.EmailLogSelect;

export async function listEmailLog(filter: EmailLogFilter, page: PaginationParams) {
  const where: Prisma.EmailLogWhereInput = {
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lt: filter.to } : {}),
          },
        }
      : {}),
  };
  const [rows, total, modules] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page.skip,
      take: page.take,
      select: LOG_SELECT,
    }),
    prisma.emailLog.count({ where }),
    prisma.emailLog.groupBy({ by: ["module"], orderBy: { module: "asc" }, take: 20 }),
  ]);
  const data = rows.map(({ _count, ...r }) => ({
    ...r,
    resent: _count.resends > 0,
    canResend:
      RESENDABLE_MODULES.has(r.module) && RESENDABLE_STATUSES.has(r.status) && _count.resends === 0,
  }));
  return { ...paginatedResponse(data, total, page), modules: modules.map((m) => m.module) };
}

/** The row a resend acts on, or why it cannot be resent. */
export async function resendTarget(
  id: string,
): Promise<{ id: string; module: string } | { problem: string; status: 404 | 409 }> {
  const row = await prisma.emailLog.findUnique({
    where: { id },
    select: { id: true, module: true, status: true, _count: { select: { resends: true } } },
  });
  if (!row) return { problem: "Email not found", status: 404 };
  if (!RESENDABLE_MODULES.has(row.module))
    return {
      problem: "Emails from this module are sent once and cannot be resent from the log.",
      status: 409,
    };
  if (!RESENDABLE_STATUSES.has(row.status))
    return { problem: "That email was already sent.", status: 409 };
  if (row._count.resends > 0) return { problem: "That email was already resent.", status: 409 };
  return { id: row.id, module: row.module };
}
