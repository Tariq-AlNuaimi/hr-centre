import { registerScopeResolver } from "@/lib/rbac/grants";

/**
 * HR tickets' two scope kinds for the role builder (HIVE ADR-073 → HR Centre
 * RBAC). Pure — no Prisma — so the contract tests and the client never pull in
 * the database to evaluate a scope.
 *
 * The subject of a ticket check is `{ hrPairId, actorPairIds }`:
 *   - HR_PAIR(id)  covers the ticket when its pair is `id` (temporary cover);
 *   - OWN_HR_PAIR  covers it when the actor's own pair(s) include the ticket's
 *                  pair. The actor's pairs come from their HR Tag member link,
 *                  read by the caller — an actor with none is covered nowhere.
 */

let registered = false;

export function registerHivePairScopes(): void {
  if (registered) return;
  registered = true;
  registerScopeResolver(
    "HR_PAIR",
    (id, s) => id !== null && typeof s.hrPairId === "string" && s.hrPairId === id,
  );
  registerScopeResolver("OWN_HR_PAIR", (_id, s) => {
    const pair = s.hrPairId;
    const mine = s.actorPairIds;
    return typeof pair === "string" && Array.isArray(mine) && mine.includes(pair);
  });
}
