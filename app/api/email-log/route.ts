import type { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { parsePagination } from "@/lib/pagination";
import { listEmailLog } from "@/lib/core/email/log";
import { emailLogQuerySchema } from "@/lib/validations/core/email-log";

/** Admin › Email log: every module's emails, metadata only (platform administrators). */
export const GET = withRateLimit(
  withAdminAuth(async (req: NextRequest) => {
    const q = emailLogQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!q.success) return err(q.error.issues[0]?.message ?? "Invalid filter", 400);
    const start = (d?: string) => (d ? new Date(`${d}T00:00:00.000Z`) : undefined);
    const to = start(q.data.to);
    return ok(
      await listEmailLog(
        {
          module: q.data.module || undefined,
          status: q.data.status,
          from: start(q.data.from),
          // The "to" day is inclusive.
          to: to ? new Date(to.getTime() + 86_400_000) : undefined,
        },
        parsePagination(req.nextUrl.searchParams),
      ),
    );
  }),
  { id: "email-log-read", limit: 120, windowMs: 60_000 },
);
