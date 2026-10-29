import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasHivePermission } from "@/lib/hive/services/permissions";
import { RaiseTicketForm } from "@/components/hive/escalations/RaiseTicketForm";

/** Raise a ticket on an employee's behalf — Drafters only (the route re-checks). */
export default async function RaiseTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  if (!(await hasHivePermission(session.user.id, "draftEscalation"))) notFound();
  const raw = (await searchParams).employeeId;
  const employeeId = typeof raw === "string" && raw.length <= 64 ? raw : null;
  return <RaiseTicketForm initialEmployeeId={employeeId} />;
}
