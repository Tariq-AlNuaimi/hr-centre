import { HiringHome } from "@/components/hiring/home/HiringHome";
import { requireSection } from "@/lib/nav/page-gate";

export default async function HiringHomePage() {
  await requireSection("/hiring");
  return <HiringHome />;
}
