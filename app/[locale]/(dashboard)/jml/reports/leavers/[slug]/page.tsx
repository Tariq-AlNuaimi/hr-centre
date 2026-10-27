import { LeaveReportScreen } from "@/components/jml/reports/LeaveReportScreen";

/** One leaver report (R1–R8). The route checks the permission and the scope. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LeaveReportScreen slug={slug} />;
}
