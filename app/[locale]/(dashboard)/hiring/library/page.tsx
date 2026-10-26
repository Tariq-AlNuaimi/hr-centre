import { redirect } from "next/navigation";

export default async function LibraryIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/hiring/library/competencies`);
}
