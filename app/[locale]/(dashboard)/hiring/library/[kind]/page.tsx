import { notFound } from "next/navigation";
import { LibraryView } from "@/components/hiring/library/LibraryView";
import { requireSection } from "@/lib/nav/page-gate";

const KINDS = ["competencies", "grades", "jd-templates", "questions"];

export default async function LibraryPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();
  await requireSection("/hiring/library");
  return <LibraryView kind={kind} />;
}
