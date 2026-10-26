import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * Server gate for Settings, matching its route's Edit content grant. Same
 * reasoning as the email template's layout: the page is a client component, and
 * an unpermitted user should not get an editor shell with a 403 behind it.
 */
export default async function HiveSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!permissions.editContent) notFound();
  return <>{children}</>;
}
