import { redirect } from "next/navigation";

/**
 * `/users` moved to `/admin/access` — ADR-070.
 *
 * A redirect rather than a deletion, and it is not politeness: bookmarks, the
 * command palette's history, an email someone sent a colleague, and any link in
 * a handover document all point here. A 404 would read as "the feature was
 * removed", which is the opposite of what happened.
 *
 * A server component, so the redirect happens before any JS ships. `permanent`
 * is deliberately NOT used: this is a product decision made this week, and a 308
 * is cached by browsers in a way that is very hard to take back if the path
 * changes again before the demo.
 */
export default async function UsersRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/access`);
}
