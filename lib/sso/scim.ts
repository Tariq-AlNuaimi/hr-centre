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
  /**
   * Stable directory user id (BoxyHQ dsync `data.id`), or null when absent. Used
   * to correlate a row across an email RENAME (ADR-045 amendment A3). The exact
   * field is per the documented BoxyHQ shape and INFRA-UNVERIFIED in-session; the
   * email fallback in provisionDirectoryEvent means a wrong assumption degrades to
   * the previous email-only behavior rather than regressing.
   */
  externalId: string | null;
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
  // Treat a string "false" as false too: some directories/proxies serialize the
  // SCIM boolean as a string, and a naive `!== false` would misread that as active
  // and miss the off-board.
  const active =
    event === "user.deleted"
      ? false
      : data.active !== false && data.active !== "false";

  // Stable directory id (BoxyHQ dsync `data.id`) for rename-safe correlation.
  const externalId =
    typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;

  return { type: event as ScimEventType, email, name, active, externalId };
}

/** The live-user fields provisioning reconciles against. */
interface ExistingUser {
  id: string;
  email: string;
  name: string | null;
  scimExternalId: string | null;
}

const EXISTING_SELECT = {
  id: true,
  email: true,
  name: true,
  scimExternalId: true,
} as const;

/**
 * Locate the live user this event refers to. Correlate on the stable directory id
 * FIRST (ADR-045 amendment A3) so a directory email-RENAME still matches the same
 * row; fall back to email for events with no externalId and for pre-externalId
 * rows (which get the id backfilled on their next update). The audited client is
 * soft-delete-filtered, so only LIVE users match — correct for both deactivation
 * (an off-boarded user is a noop) and update (a name change doesn't resurrect a
 * deleted row).
 */
async function findExistingUser(evt: NormalizedScimEvent): Promise<ExistingUser | null> {
  if (evt.externalId) {
    const byId = await prisma.user.findUnique({
      where: { scimExternalId: evt.externalId },
      select: EXISTING_SELECT,
    });
    if (byId) return byId;
  }
  return prisma.user.findUnique({ where: { email: evt.email }, select: EXISTING_SELECT });
}

/**
 * Apply a normalized directory event to the User model through the audited prisma
 * client. Idempotent per event; returns the action taken so the caller can log a
 * count (never the email — PII stays out of logs).
 */
export async function provisionDirectoryEvent(
  evt: NormalizedScimEvent,
): Promise<{ action: ScimAction }> {
  const existing = await findExistingUser(evt);

  // Deactivate / off-board: soft-delete a live user; unknown user => noop.
  if (!evt.active) {
    if (!existing) return { action: "noop" };
    await prisma.user.delete({ where: { id: existing.id } });
    return { action: "deactivated" };
  }

  // Create at VIEWER (least privilege), stamping the directory id for future
  // rename-safe correlation. A collision on a soft-deleted email/externalId
  // (rehire) surfaces as P2002 — documented v1 noop, manual restore covers it.
  if (!existing) {
    try {
      await prisma.user.create({
        data: {
          email: evt.email,
          name: evt.name,
          role: "VIEWER",
          scimExternalId: evt.externalId,
        },
      });
      return { action: "created" };
    } catch (err) {
      if (isUniqueViolation(err)) return { action: "noop" };
      throw err;
    }
  }

  // Update: reconcile email (a RENAME, when matched by directory id) + name, and
  // backfill the directory id onto a row first matched by email. Role is NEVER
  // touched here (an in-app promotion survives a re-sync).
  const data: { email?: string; name?: string; scimExternalId?: string } = {};
  if (evt.email !== existing.email) data.email = evt.email;
  if (evt.name !== null && evt.name !== existing.name) data.name = evt.name;
  if (evt.externalId && existing.scimExternalId === null) data.scimExternalId = evt.externalId;
  if (Object.keys(data).length === 0) return { action: "noop" };

  try {
    await prisma.user.update({ where: { id: existing.id }, data });
    return { action: "updated" };
  } catch (err) {
    // A renamed email (or backfilled id) now colliding with ANOTHER live row =>
    // P2002. Don't 500 the webhook on a directory-side duplicate; noop and let the
    // operator reconcile (same posture as the rehire collision on create).
    if (isUniqueViolation(err)) return { action: "noop" };
    throw err;
  }
}
