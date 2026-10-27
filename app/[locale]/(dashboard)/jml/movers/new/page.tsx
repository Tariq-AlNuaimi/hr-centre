import { MoverStart } from "@/components/jml/movers/MoverStart";
import { prefilledEmployee } from "@/components/jml/prefill";

/**
 * Start an internal change for an employee. `?employeeId=` pre-fills the person
 * when it is opened from Performance's transfer screen (UX review P0, US-2).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MoverStart initialEmployeeId={prefilledEmployee(await searchParams)?.id ?? null} />;
}
