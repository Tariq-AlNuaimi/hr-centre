import { redirect } from "next/navigation";

/**
 * `/admin/roles` moved to `/admin/access` — ADR-070.
 *
 * The HR-roles editor is now the "HR authority" section of the merged access
 * screen; the component itself (components/pms/RoleEditor.tsx) is unchanged and
 * still gated on HR Super Admin. See the redirect note in
 * app/[locale]/(dashboard)/users/page.tsx for why this is a redirect.
 */
export default async function RolesRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/access`);
}
