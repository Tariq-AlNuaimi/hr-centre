import { withAuth } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * The HR Tag pairs, as names — for the role builder's "HR pair" scope picker
 * (platform admins) and the ticket screens' pair filter. Names only: who covers
 * what is HR Tag data, served by the pairs admin screen.
 */
export const GET = withAuth(async (_request, { session }) => {
  if (session.user.role !== "ADMIN") {
    const p = await getHivePermissions(session.user.id);
    if (!p.seeTickets && !p.configure) return forbidden();
  }
  const pairs = await prisma.hrTagPair.findMany({
    select: { id: true, name: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    take: 100,
  });
  return ok(pairs);
});
