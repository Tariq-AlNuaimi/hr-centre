import { redirect } from "next/navigation";

/** The JML module's landing — the case list until the dashboard arrives (slice S7). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/jml/cases`);
}
