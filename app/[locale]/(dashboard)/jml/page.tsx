import { redirect } from "next/navigation";

/**
 * The JML module's landing. Slice S2 ships configuration only, so it opens the
 * settings hub; the dashboard replaces this when the case screens arrive.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/jml/settings`);
}
