import {
  issueMagicLink,
  magicLinkUrl,
  resolveMagicLink,
  revokeMagicLinks,
} from "@/lib/core/tokens/magic-link";

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
 * The mechanics live in the core magic-link service (ADR-090); this file is the
 * ticket module's binding of it: purpose `hive.reply`, 30 days, `/reply/<token>`.
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

/** The magic-link purpose that namespaces reply links (ADR-090). */
const REPLY_LINK_PURPOSE = "hive.reply";

/**
 * Mint a link for one escalation. Returns the RAW token, which is the only time
 * it exists anywhere outside the email. Previous links stay valid (additive
 * re-requests — the employee may be reading the older email).
 */
export function issueReplyToken(escalationId: string): Promise<string> {
  return issueMagicLink({
    purpose: REPLY_LINK_PURPOSE,
    subjectId: escalationId,
    ttlMs: REPLY_TOKEN_TTL_MS,
  });
}

/** The full URL that goes in the email, from a server-configured origin. */
export function replyLinkFor(origin: string, rawToken: string): string {
  return magicLinkUrl(origin, "reply", rawToken);
}

/**
 * Resolve a raw token to the escalation it grants, or `null` — malformed,
 * unknown, expired and revoked are one indistinguishable answer (clause 6).
 */
export async function resolveReplyToken(raw: string): Promise<{ escalationId: string } | null> {
  const grant = await resolveMagicLink(REPLY_LINK_PURPOSE, raw);
  return grant ? { escalationId: grant.subjectId } : null;
}

/** ADR-070 clause 4: revoke every link to an escalation (called when HR close it). */
export function revokeReplyTokens(escalationId: string): Promise<number> {
  return revokeMagicLinks(REPLY_LINK_PURPOSE, escalationId);
}
