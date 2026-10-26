import { CandidateList } from "@/components/hiring/candidates/CandidateList";
import { isStage } from "@/lib/hiring/stage-rules";

/** `?stage=` deep-links a stage filter (D9 — DECISION_PENDING included). */
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const stage = (await searchParams).stage;
  return <CandidateList initialStage={isStage(stage) ? stage : undefined} />;
}
