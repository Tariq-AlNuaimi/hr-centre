// lib/sso/scim.ts — SCIM 2.0 directory provisioning (ADR-045, WS-6).
//
// Ory Polis owns the SCIM protocol (PATCH quirks and all) and emits BoxyHQ
// Directory-Sync ("dsync") webhook events. This module is the thin app-side
// handler: normalize a dsync event, then apply it to the existing User model
// through the AUDITED prisma client, reusing the soft-delete + audit invariants.
//
// Trust-boundary posture:
//   - VIEWER on create (least privilege; an admin promotes in-app — same stance
//     as mapSsoRole / ADR-024). We NEVER change an existing user's role on a
//     re-sync, so an in-app promotion survives (mirrors the jwt callback not
//     re-mapping IdP claims).
//   - Deactivation (user.deleted / active:false) soft-deletes the user
//     (prisma.user.delete → the soft-delete extension writes deletedAt), which
//     the auth signIn callback already treats as an off-board sign-in block.
//   - Only the audited `prisma` client is used (no prismaUnfiltered — that would
//     trip no-prisma-unfiltered-import and widen the trust surface), so a rehire
//     (re-create of a soft-deleted email) is a documented v1 no-op; manual
//     restore via the recycling bin covers it (ADR-045 non-goal).

import { prisma } from "@/lib/prisma";

/**
 * True for a Prisma unique-constraint violation (P2002). Duck-typed on `.code`
 * rather than `instanceof Prisma.PrismaClientKnownRequestError` so this file has
 * no dependency on the generated client's runtime value (read-denied) and is
 * robust across client regenerations.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** The dsync event types this handler acts on; others are ignored (noop). */
export type ScimEventType = "user.created" | "user.updated" | "user.deleted";

/** A normalized, provider-agnostic view of a directory event. */
export interface NormalizedScimEvent {
  type: ScimEventType;
  /** Lowercased, trimmed — matches how the app stores/looks up emails. */
  email: string;
  /** Display name, or null when the directory sent none. */
  name: string | null;
  /** false => the user is deactivated/removed in the directory. */
  active: boolean;
}

/** What provisioning did — the route logs the action (counts only, no PII). */
export type ScimAction = "created" | "updated" | "deactivated" | "noop";

const HANDLED: ReadonlySet<string> = new Set([
  "user.created",
  "user.updated",
  "user.deleted",
]);

/**
 * Normalize a raw BoxyHQ dsync webhook body to {@link NormalizedScimEvent}, or
 * null for anything this handler does not act on (group events, membership
 * events, missing email). Tolerant of shape drift: reads name from `name` or
 * first/last, active defaults to true unless explicitly false or a delete event.
 */
export function normalizeDirectoryEvent(raw: unknown): NormalizedScimEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const event = typeof body.event === "string" ? body.event : "";
  if (!HANDLED.has(event)) return null;

  const data = (body.data ?? {}) as Record<string, unknown>;
  const rawEmail = typeof data.email === "string" ? data.email : "";
  const email = rawEmail.toLowerCase().trim();
  if (!email) return null;

  const first = typeof data.first_name === "string" ? data.first_name : "";
  const last = typeof data.last_name === "string" ? data.last_name : "";
  const combined = `${first} ${last}`.trim();
  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : combined || null;

  // A delete event is always a deactivation; otherwise honor `active` (default
  // true — a created/updated event with no active flag means the user is active).
  const active = event === "user.deleted" ? false : data.active !== false;

  return { type: event as ScimEventType, email, name, active };
}

/**
 * Apply a normalized directory event to the User model through the audited prisma
 * client. Idempotent per event; returns the action taken so the caller can log a
 * count (never the email — PII stays out of logs).
 */
export async function provisionDirectoryEvent(
  evt: NormalizedScimEvent,
): Promise<{ action: ScimAction }> {
  // The audited client is soft-delete-filtered: this only finds LIVE users, which
  // is exactly right for deactivation (an already-off-boarded user is a noop) and
  // for update (we don't resurrect the deleted via a name change).
  const existing = await prisma.user.findUnique({
    where: { email: evt.email },
    select: { id: true, name: true },
  });

  // Deactivate / off-board: soft-delete a live user; unknown user => noop.
  if (!evt.active) {
    if (!existing) return { action: "noop" };
    await prisma.user.delete({ where: { id: existing.id } });
    return { action: "deactivated" };
  }

  // Create at VIEWER (least privilege). A collision on a soft-deleted email
  // (rehire) surfaces as P2002 — documented v1 noop, manual restore covers it.
  if (!existing) {
    try {
      await prisma.user.create({
        data: { email: evt.email, name: evt.name, role: "VIEWER" },
      });
      return { action: "created" };
    } catch (err) {
      if (isUniqueViolation(err)) return { action: "noop" };
      throw err;
    }
  }

  // Update: name only. Role is NEVER touched here (an in-app promotion survives).
  if (evt.name !== null && evt.name !== existing.name) {
    await prisma.user.update({ where: { id: existing.id }, data: { name: evt.name } });
    return { action: "updated" };
  }
  return { action: "noop" };
}
