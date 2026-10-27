import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * Server gate for HR tickets' reference-data screens (pairs, rotation,
 * discounts, providers, org-chart details), matching their routes'
 * `tickets.configure`. The pages are client components; without this an
 * unpermitted user would get editors with 403s behind them.
 */
export default async function HiveSetupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!permissions.configure) notFound();
  return <>{children}</>;
}
