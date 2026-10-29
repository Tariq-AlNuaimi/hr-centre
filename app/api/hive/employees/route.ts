import type { NextRequest } from "next/server";
import { err, ok } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { searchTicketEmployees } from "@/lib/hive/services/escalation-raise";
import { ticketEmployeeQuerySchema } from "@/lib/validations/hive/escalation";

/**
 * The raise-on-behalf form's employee picker: up to 20 people (name, work
 * email, company — nothing else), for Drafters only.
 */
export const GET = withAuth(
  requireHivePermission("draftEscalation", async (req: NextRequest) => {
    const url = new URL(req.url);
    const parsed = ticketEmployeeQuerySchema.safeParse({
      search: url.searchParams.get("search") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
    });
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid search.", 400);
    return ok(await searchTicketEmployees(parsed.data));
  }),
);
