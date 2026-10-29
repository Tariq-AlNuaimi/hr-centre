import type { Session } from "next-auth";
import { resolveActor } from "@/lib/core/actor";
import { grantsOf } from "@/lib/core/permissions";
import { has } from "@/lib/rbac/grants";
import { permissionsFrom } from "@/lib/hive/services/permissions";
import { isTaskWorker } from "@/lib/jml/routing/worker";
import { personaOf, type NavContext } from "./config";

/**
 * The server-side twin of `useNavContext`: the same `NavContext`, built from
 * the same sources the access APIs serve (`/api/pms/me`, `/api/hive/me/permissions`,
 * `/api/jml/me`, `/api/hiring/me`), in one actor resolution. Server pages that
 * list destinations (the Admin › Settings hub) read it so they list exactly
 * what the sidebar shows this viewer.
 */
export async function navContextFor(session: Session): Promise<NavContext> {
  const actor = await resolveActor(session);
  const grants = grantsOf(actor);
  const hive = permissionsFrom(grants);
  const c = actor.capabilities;
  const ctx: Omit<NavContext, "persona"> = {
    isAdmin: session.user?.role === "ADMIN",
    employeeId: actor.employeeId,
    pms: {
      hr: c.hr,
      lineManager: c.lineManager,
      orgWide: c.orgWide,
      runCalibration: c.runCalibration,
      previewImport: c.previewImport,
      orgManage: c.orgManage,
      loginsManage: c.loginsManage,
    },
    hive: {
      // QA D-03: a Drafter/Approver opens the queue (limited to their pairs).
      seeTickets: hive.seeTickets || hive.draftEscalation || hive.approve,
      viewReports: hive.viewReports,
      editContent: hive.editContent,
      configure: hive.configure,
    },
    jml: (p) => has(grants, p),
    jmlTaskWorker: await isTaskWorker(actor),
    hiring: (p) => has(grants, p),
  };
  // P2 (R22) — the persona flag, derived from the same capabilities.
  return { ...ctx, persona: personaOf(ctx) };
}
