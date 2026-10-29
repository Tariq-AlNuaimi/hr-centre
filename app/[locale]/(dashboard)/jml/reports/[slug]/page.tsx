import { ReportScreen } from "@/components/jml/reports/ReportScreen";
import { requireSection } from "@/lib/nav/page-gate";
import { requireRecord } from "@/lib/nav/record-gate";

/** One report. The page checks the permission as well as the route (Onboarding 8.4.1). */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireSection("/jml/reports");
  await requireRecord("jml.report", slug);
  return <ReportScreen slug={slug} />;
}
