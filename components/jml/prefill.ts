/**
 * `?employeeId=&name=` on a "new case" page, read defensively: a single short
 * value each, or nothing. Display-only — the create route re-reads the employee
 * and re-checks scope, so a forged id gets the route's own refusal.
 */
export function prefilledEmployee(
  sp: Record<string, string | string[] | undefined>,
): { id: string; name: string } | null {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
  const id = one(sp.employeeId);
  if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const name = one(sp.name).slice(0, 200);
  return { id, name: name || id };
}
