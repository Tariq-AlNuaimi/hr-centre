import { ExitStart } from "@/components/jml/leavers/ExitStart";
import { prefilledEmployee } from "@/components/jml/prefill";

/**
 * Open an exit case for an employee. `?employeeId=&name=` pre-fills the person
 * when it is opened from their record (UX review P0, US-2) — display only; the
 * create route re-reads and re-checks the employee.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ExitStart initialEmployee={prefilledEmployee(await searchParams)} />;
}
