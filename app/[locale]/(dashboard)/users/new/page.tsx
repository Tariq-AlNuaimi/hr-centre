import { redirect } from "next/navigation";

/** `/users/new` moved to `/admin/access/new` — ADR-070. See ../page.tsx. */
export default async function NewUserRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/access/new`);
}
