import { redirect } from "next/navigation";

/**
 * `/users/<id>` moved to `/admin/access/<id>` — ADR-070.
 *
 * The id is carried through rather than dropping the visitor on the list: a link
 * to a specific account is usually someone mid-task, and landing them on the
 * index makes them find the row again.
 */
export default async function EditUserRedirect({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect(`/${locale}/admin/access/${id}`);
}
