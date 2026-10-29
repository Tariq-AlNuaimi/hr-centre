import { LeaveReportScreen } from "@/components/jml/reports/LeaveReportScreen";
import { requireSection } from "@/lib/nav/page-gate";
import { requireRecord } from "@/lib/nav/record-gate";

/** One leaver report (R1–R8). The route checks the permission and the scope. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireSection("/jml/reports");
  await requireRecord("jml.leaveReport", slug);
  return <LeaveReportScreen slug={slug} />;
}
