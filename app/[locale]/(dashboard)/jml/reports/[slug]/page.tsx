import { ReportScreen } from "@/components/jml/reports/ReportScreen";

/** One report. The page checks the permission as well as the route (Onboarding 8.4.1). */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ReportScreen slug={slug} />;
}
