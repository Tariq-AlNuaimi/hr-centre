/**
 * What a role change grants and revokes (UX P1 R12 — "see what they're gaining
 * and losing" before saving). Pure; order follows the catalogue order of `after`
 * then `before`, so the preview reads like the role form.
 */
export function permissionDiff(
  before: readonly string[],
  after: readonly string[],
): { gained: string[]; lost: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return {
    gained: after.filter((p) => !was.has(p)),
    lost: before.filter((p) => !now.has(p)),
  };
}

/** The permissions a role would ADD for someone who already holds `held` (any scope). */
export function newPermissions(held: readonly string[], role: readonly string[]): string[] {
  const has = new Set(held);
  return role.filter((p) => !has.has(p));
}
