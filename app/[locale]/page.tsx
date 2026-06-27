import { redirect } from "next/navigation";

// The locale root sends authenticated users into the app (middleware redirects
// unauthenticated traffic to /login before this renders).
export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/app`);
}
