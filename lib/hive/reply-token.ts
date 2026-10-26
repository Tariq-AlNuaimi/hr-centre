import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";

/**
 * ADR-070's reply-link token (AC-9.4…AC-9.7, tasks 5.3 / 5.3b).
 *
 * A bearer credential to Confidential data, on an app whose employee surface is
 * anonymous and publicly reachable. ADR-070 exists because of that, and its
 * "Token contract" section is a list of seven clauses this file implements:
 *
 *   1. **One escalation, nothing else.** {@link resolveReplyToken} returns an
 *      escalation id and nothing that could widen into a session. There is no
 *      user, no session mint, no topic access — a scoped capability, not a login.
 *   2. **30 days**, re-requestable ({@link REPLY_TOKEN_TTL_MS}).
 *   3. **Signed and unguessable** — 32 bytes of CSPRNG output, and only its
 *      SHA-256 digest is stored.
 *   4. **Revocable**, and revoked when HR close the escalation
 *      ({@link revokeReplyTokens}).
 *   5. Rate-limited per token as well as per IP — in the route, since that is
 *      where the request is.
 *   6. **An invalid, expired or revoked link reveals nothing.** Every failure
 *      here is the same value, `null`. The route cannot accidentally tell the
 *      three apart because it is never told which one happened.
 *   7. `noindex` / `Cache-Control: private` — in the route and the page.
 *
 * SHA-256 rather than Argon2, deliberately: the input is 32 bytes of CSPRNG
 * output, not a low-entropy human secret. There is no dictionary to slow down,
 * and the lookup is exact equality on a unique index. Same reasoning as
 * `app/api/auth/forgot-password/route.ts`, which stores reset tokens the same way
 * and for the same reason.
 *
 * @public
 */

/**
 * ADR-070 clause 2, with its reasoning: "7 days would strand an answer approved
 * on day 6, and no expiry means a live link sitting in a mailbox at
 * offboarding." §5.4 deliberately promises no turnaround time, so the gap
 * between question and answer can be days.
 */
export const REPLY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a link for one escalation. Returns the RAW token, which is the only time
 * it exists anywhere outside the email.
 *
 * Previous tokens for the escalation are NOT revoked. A re-request is additive
 * on purpose: the employee may have the first email open in one place and the
 * second in another, and invalidating the older link would break the copy they
 * are actually looking at — for a capability that already expires on its own.
 */
export async function issueReplyToken(escalationId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.escalationReplyToken.create({
    data: {
      escalationId,
      tokenHash: digest(raw),
      expiresAt: new Date(Date.now() + REPLY_TOKEN_TTL_MS),
    },
    select: { id: true },
  });
  return raw;
}

/**
 * The full URL that goes in the email.
 *
 * Built from a server-configured origin, never the request's Host header: a
 * forwarded or attacker-controlled Host would poison the emailed link and hand
 * over the token, which is the same reset-poisoning the forgot-password route
 * guards against — except the prize here is a Confidential thread.
 */
export function replyLinkFor(origin: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, "")}/reply/${rawToken}`;
}

/**
 * Resolve a raw token to the escalation it grants, or `null`.
 *
 * ADR-070 clause 6 is why there is one failure value rather than an error union.
 * Malformed, unknown, expired and revoked are four different facts, and any way
 * of telling them apart is an oracle: "this token existed but expired" confirms
 * a real escalation to whoever is guessing. The caller gets `null` and says the
 * one thing AC-9.7 permits.
 *
 * `lastUsedAt` is recorded on success. It is not a control — it is what makes a
 * leaked link visible after the fact rather than only in principle.
 */
export async function resolveReplyToken(raw: string): Promise<{ escalationId: string } | null> {
  // Cheap shape check first, so a query is not spent on a value that cannot be
  // a token. 32 bytes of base64url is 43 characters.
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;

  const row = await prisma.escalationReplyToken.findUnique({
    where: { tokenHash: digest(raw) },
    select: { id: true, escalationId: true, expiresAt: true, revokedAt: true },
  });
  if (!row) return null;
  // Checked against the clock on READ. An expiry column that is only consulted
  // by a cleanup job is a suggestion — the row is what the route trusts, so the
  // row is where the check has to be.
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  await prisma.escalationReplyToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
    select: { id: true },
  });
  return { escalationId: row.escalationId };
}

/**
 * ADR-070 clause 4: revoke every link to an escalation.
 *
 * Called when HR close it.
 *
 * `updateMany` with ONE explicit audit row, rather than a loop through the
 * audited client. The audit extension does not hook `updateMany`, so the
 * suppression below is paired with a `recordAudit()` that carries the fact worth
 * keeping: bearer access to this escalation was withdrawn, by whom (the request
 * context), and how many links it covered. Looping would produce N rows each
 * restating one boolean about a credential digest — more audit, less signal, and
 * a revocation that is no longer one event.
 */
export async function revokeReplyTokens(escalationId: string): Promise<number> {
  const now = new Date();
  // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- audited by the recordAudit() below, as one revocation event (see above)
  const result = await prisma.escalationReplyToken.updateMany({
    where: { escalationId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count > 0) {
    await recordAudit(prisma, {
      entityType: "EscalationReplyToken",
      entityId: escalationId,
      action: "UPDATE",
      // No hash, no token, no employee data — just the fact and its size.
      after: { revoked: result.count, revokedAt: now.toISOString() },
    });
  }
  return result.count;
}
