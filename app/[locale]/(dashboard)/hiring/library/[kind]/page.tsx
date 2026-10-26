import { notFound } from "next/navigation";
import { LibraryView } from "@/components/hiring/library/LibraryView";

const KINDS = ["competencies", "grades", "jd-templates", "questions"];

export default async function LibraryPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();
  return <LibraryView kind={kind} />;
}
