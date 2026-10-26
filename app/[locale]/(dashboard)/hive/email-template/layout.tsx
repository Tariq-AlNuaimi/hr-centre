import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * Server gate for the Email Template screen, matching its route's
 * `canEditContent`.
 *
 * The page is a client component, so without this an unpermitted user would get
 * the editor shell with a 403 behind it — an empty textarea that looks like a
 * template nobody has written, on a screen where the obvious next move is to
 * type one and press Save.
 */
export default async function HiveEmailTemplateLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!permissions.editContent) notFound();
  return <>{children}</>;
}
