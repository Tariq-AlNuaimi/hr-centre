import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";

/**
 * The platform's one magic-link primitive (ADR-090): a hashed, expiring,
 * revocable bearer link to ONE subject for ONE purpose — the HR-ticket reply
 * link, the agency submission link, and any new public link (preboarding,
 * candidate status) a module needs.
 *
 * The contract every caller inherits (ADR-070's token clauses, generalised):
 *   - 32 bytes of CSPRNG output, base64url (43 chars); only its SHA-256 digest
 *     is stored. SHA-256 rather than a slow hash on purpose: the input is not a
 *     low-entropy human secret and the lookup is exact equality on a unique index.
 *   - The expiry and revocation are checked on READ, against the row.
 *   - Every failure (malformed, unknown, wrong purpose, expired, revoked) is the
 *     same `null`, so no caller can become an oracle.
 *   - A malformed value costs no query; a failed resolve writes nothing; a
 *     successful one stamps `lastUsedAt` so a leaked link is visible later.
 *   - The resolve returns the subject id and nothing that could widen into a
 *     session. Rate limiting and `noindex` stay in the public route.
 *
 * `purpose` namespaces the link: a reply token can never open an agency page.
 */

const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A fresh raw token. It exists only in the link it is put in. */
export function mintRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The digest that is stored and looked up. */
export function digestToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Cheap shape check, so a megabyte of path never reaches a hash or a query. */
export function isTokenShaped(raw: string): boolean {
  return TOKEN_SHAPE.test(raw);
}

/** Whether a stored link is usable now: not revoked and not past its expiry. */
export function isLinkLive(
  row: { expiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return row.revokedAt === null && row.expiresAt.getTime() > now.getTime();
}

/**
 * The full URL for an emailed link, built from a server-configured origin —
 * never the request's Host header (a forged Host would poison the link and hand
 * over the token).
 */
export function magicLinkUrl(origin: string, path: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+|\/+$/g, "")}/${rawToken}`;
}

interface IssueOptions {
  purpose: string;
  subjectId: string;
  ttlMs: number;
  createdById?: string | null;
}

/**
 * Mint a link and store its digest. Returns the RAW token. Earlier links to the
 * same subject stay valid (additive re-requests: the recipient may be looking
 * at the older email); revoke explicitly when the subject closes.
 */
export async function issueMagicLink(opts: IssueOptions): Promise<string> {
  const raw = mintRawToken();
  await prisma.magicLink.create({
    data: {
      purpose: opts.purpose,
      subjectId: opts.subjectId,
      tokenHash: digestToken(raw),
      expiresAt: new Date(Date.now() + opts.ttlMs),
      createdById: opts.createdById ?? null,
    },
    select: { id: true },
  });
  return raw;
}

/** Resolve a raw token for one purpose to its subject id, or `null` (one failure value). */
export async function resolveMagicLink(
  purpose: string,
  raw: string,
): Promise<{ subjectId: string } | null> {
  if (!isTokenShaped(raw)) return null;
  const row = await prisma.magicLink.findUnique({
    where: { tokenHash: digestToken(raw) },
    select: { id: true, purpose: true, subjectId: true, expiresAt: true, revokedAt: true },
  });
  if (!row || row.purpose !== purpose || !isLinkLive(row)) return null;
  await prisma.magicLink.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
    select: { id: true },
  });
  return { subjectId: row.subjectId };
}

/**
 * Revoke every live link of one purpose to one subject. `updateMany` with ONE
 * explicit audit row (the audit extension does not hook updateMany): the fact
 * that bearer access was withdrawn and how many links it covered — never a
 * digest.
 */
export async function revokeMagicLinks(purpose: string, subjectId: string): Promise<number> {
  const now = new Date();
  // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- audited by the recordAudit() below, as one revocation event
  const result = await prisma.magicLink.updateMany({
    where: { purpose, subjectId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count > 0) {
    await recordAudit(prisma, {
      entityType: "MagicLink",
      entityId: subjectId,
      action: "UPDATE",
      after: { purpose, revoked: result.count, revokedAt: now.toISOString() },
    });
  }
  return result.count;
}
