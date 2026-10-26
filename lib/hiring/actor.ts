import type { Session } from "next-auth";
import { loadGrants } from "@/lib/rbac/resolve";
import type { HiringActor } from "./access";

/**
 * Session → hiring actor. ONE assignments query per request (lib/rbac/resolve);
 * every authority question afterwards is a pure call into ./access.
 *
 * A user with no hiring assignment gets an actor with no grants — Interview
 * Hub's PENDING role: zero capabilities, fail closed.
 */
export async function resolveHiringActor(session: Session): Promise<HiringActor> {
  return {
    userId: session.user.id,
    name: session.user.name ?? session.user.email ?? "Unknown",
    grants: await loadGrants(session.user.id),
  };
}
