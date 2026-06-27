import { prisma } from "@/lib/prisma";
import { Prisma, InvitationStatus } from "@/generated/prisma/client";
import { generateInvitationToken, hashInvitationToken } from "@/lib/token";
import { sendEmail, isEmailEnabled, type SendEmailResult } from "@/lib/email";
import type { RecipientInput, RecipientResult } from "@/lib/validations/invitation";

// Service layer for Phase-5 invitations (ARCHITECTURE §12.5, UI-SPEC D.5). Owns
// tokenized link generation (hash-at-rest, lib/token.ts), single + bulk send with
// per-recipient results, resend (token rotation), revoke, the OPENED beacon, and
// the tenant-scoped list. Every write goes through the audited `prisma` client
// (Invitation is an audited + soft-deletable model); the candidateEmail is
// Confidential (SECURITY.md §1) and never logged.

// ---- Status (sent/opened/started/completed/expired) ----

// Display status: an invitation past its expiry that the candidate never finished
// reads as EXPIRED regardless of the stored lifecycle value (the stored value only
// flips to EXPIRED lazily; resolveToken applies the same rule for the candidate).
export function effectiveStatus(inv: {
  status: InvitationStatus;
  expiresAt: Date | null;
}): InvitationStatus {
  if (
    inv.expiresAt &&
    inv.expiresAt.getTime() < Date.now() &&
    inv.status !== InvitationStatus.COMPLETED &&
    inv.status !== InvitationStatus.REVOKED
  ) {
    return InvitationStatus.EXPIRED;
  }
  return inv.status;
}

// ---- List (UI-SPEC D.5 list: email/role/status/sent-date/sent-by/batch) ----

export type InvitationListFilters = {
  skip: number;
  take: number;
  status?: InvitationStatus;
  roleProfileId?: string;
};

export type InvitationRow = {
  id: string;
  candidateEmail: string;
  candidateName: string | null;
  status: InvitationStatus; // effective (expiry applied)
  expiresAt: Date | null;
  locale: string;
  batchId: string | null;
  createdAt: Date;
  roleProfileId: string;
  roleTitle: string;
  roleFamily: string;
  sentByName: string | null;
};

// Translate a requested status filter into a where-clause that matches the
// EFFECTIVE status the list renders (effectiveStatus). EXPIRED is never stored —
// it's derived from expiresAt — so filtering on the raw column would make the
// EXPIRED bucket return nothing and the non-terminal buckets include rows the UI
// shows as expired. This keeps the filter consistent with the badge.
function statusWhere(status?: InvitationStatus): Prisma.InvitationWhereInput {
  if (!status) return {};
  const now = new Date();
  const nonTerminal: InvitationStatus[] = [
    InvitationStatus.PENDING,
    InvitationStatus.OPENED,
    InvitationStatus.STARTED,
  ];
  if (status === InvitationStatus.EXPIRED) {
    return { status: { in: nonTerminal }, expiresAt: { lt: now } };
  }
  if (nonTerminal.includes(status)) {
    // A non-terminal status that hasn't passed its expiry (or has none).
    return { status, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };
  }
  // COMPLETED / REVOKED are terminal — expiry never overrides them.
  return { status };
}

/** Tenant-scoped, bounded, paginated invitations list (soft-deleted excluded). */
export async function listInvitations(
  orgId: string,
  filters: InvitationListFilters
): Promise<{ data: InvitationRow[]; total: number }> {
  const where: Prisma.InvitationWhereInput = {
    orgId,
    ...(filters.roleProfileId ? { roleProfileId: filters.roleProfileId } : {}),
    ...statusWhere(filters.status),
  };

  const [rows, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      skip: filters.skip,
      take: filters.take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        candidateEmail: true,
        candidateName: true,
        status: true,
        expiresAt: true,
        locale: true,
        batchId: true,
        createdAt: true,
        roleProfileId: true,
        sentById: true,
        roleProfile: {
          select: { title: true, roleFamily: { select: { name: true } } },
        },
      },
    }),
    prisma.invitation.count({ where }),
  ]);

  // Resolve sender display names in one bounded query (sentById is a plain id, not
  // a relation — no N+1). Same org as the invitations, so no cross-tenant leak.
  const senderIds = [...new Set(rows.map((r) => r.sentById).filter((x): x is string => !!x))];
  const senders =
    senderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: senderIds }, orgId },
          select: { id: true, name: true, email: true },
        })
      : [];
  const senderName = new Map(senders.map((u) => [u.id, u.name ?? u.email]));

  const data: InvitationRow[] = rows.map((r) => ({
    id: r.id,
    candidateEmail: r.candidateEmail,
    candidateName: r.candidateName,
    status: effectiveStatus(r),
    expiresAt: r.expiresAt,
    locale: r.locale,
    batchId: r.batchId,
    createdAt: r.createdAt,
    roleProfileId: r.roleProfileId,
    roleTitle: r.roleProfile.title,
    roleFamily: r.roleProfile.roleFamily.name,
    sentByName: r.sentById ? senderName.get(r.sentById) ?? null : null,
  }));

  return { data, total };
}

/** Active role profiles for the send panel's picker (tenant-scoped, bounded). */
export async function listActiveRoleProfiles(orgId: string) {
  return prisma.roleProfile.findMany({
    where: { orgId, status: "ACTIVE" },
    orderBy: { title: "asc" },
    take: 200,
    select: { id: true, title: true, version: true, roleFamily: { select: { name: true } } },
  });
}

// ---- Send (single + bulk) ----

type SendParams = {
  orgId: string;
  userId: string;
  roleProfileId: string;
  baseUrl: string;
  locale: "en" | "ar";
  expiresInDays: number | null;
  message: string | null;
  batchId: string | null;
};

// Resolve + validate the target role profile once (must be ACTIVE + same org).
async function activeRoleProfile(orgId: string, roleProfileId: string) {
  return prisma.roleProfile.findFirst({
    where: { id: roleProfileId, orgId, status: "ACTIVE" },
    select: { id: true, title: true, org: { select: { name: true } } },
  });
}

// True when a non-terminal (open) invitation already exists for this candidate +
// role — used to skip duplicates instead of spamming a second link.
async function openInvitationExists(
  orgId: string,
  roleProfileId: string,
  email: string
): Promise<boolean> {
  const existing = await prisma.invitation.findFirst({
    where: {
      orgId,
      roleProfileId,
      candidateEmail: email,
      status: {
        in: [
          InvitationStatus.PENDING,
          InvitationStatus.OPENED,
          InvitationStatus.STARTED,
        ],
      },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

function expiryFrom(days: number | null): Date | null {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// Create one invitation + send its email. Returns a per-recipient result; never
// throws for an email failure (the invite still exists with a working link).
async function createOne(
  params: SendParams,
  recipient: RecipientInput,
  profile: { title: string; org: { name: string } }
): Promise<RecipientResult> {
  const email = recipient.email;
  // Skip a candidate who already has an OPEN invite for this role (don't create a
  // duplicate link). NB: an invite whose email send failed still exists as PENDING
  // here, so re-running a bulk to "retry" it skips it — that's intentional. The
  // recovery path for a failed send is the per-row Resend (rotates the token +
  // re-emails the SAME invitation), not a duplicate create.
  if (await openInvitationExists(params.orgId, params.roleProfileId, email)) {
    return { email, outcome: "skipped", reason: "already-invited" };
  }

  const rawToken = generateInvitationToken();
  try {
    await prisma.invitation.create({
      data: {
        orgId: params.orgId,
        roleProfileId: params.roleProfileId,
        candidateEmail: email,
        candidateName: recipient.name ?? null,
        tokenHash: hashInvitationToken(rawToken),
        status: InvitationStatus.PENDING,
        locale: params.locale,
        expiresAt: expiryFrom(params.expiresInDays),
        sentById: params.userId,
        batchId: params.batchId,
      },
    });
  } catch (e) {
    // A unique race on tokenHash (astronomically unlikely) or any DB error → the
    // recipient failed; the batch carries on.
    return { email, outcome: "failed", reason: dbReason(e) };
  }

  const result = await deliver(params, recipient, rawToken, profile);
  return result;
}

async function deliver(
  params: SendParams,
  recipient: RecipientInput,
  rawToken: string,
  profile: { title: string; org: { name: string } }
): Promise<RecipientResult> {
  const link = `${params.baseUrl}/a/${rawToken}`;
  let res: SendEmailResult;
  try {
    res = await sendInvitationEmail({
      to: recipient.email,
      candidateName: recipient.name ?? null,
      roleTitle: profile.title,
      orgName: profile.org.name,
      link,
      locale: params.locale,
      message: params.message,
    });
  } catch {
    // The invitation exists (link works); only the email transport failed.
    return { email: recipient.email, outcome: "failed", reason: "email-error" };
  }
  return {
    email: recipient.email,
    outcome: res.sent ? "sent" : "created",
    reason: res.sent ? undefined : "email-disabled",
  };
}

export type SingleResult =
  | { status: 201; result: RecipientResult }
  | { status: 400 | 409; error: string };

/** Single send (UI-SPEC D.5 "Single"). */
export async function createInvitation(args: {
  orgId: string;
  userId: string;
  baseUrl: string;
  input: {
    roleProfileId: string;
    email: string;
    name?: string | null;
    expiresInDays?: number | null;
    locale: "en" | "ar";
    message?: string | null;
  };
}): Promise<SingleResult> {
  const profile = await activeRoleProfile(args.orgId, args.input.roleProfileId);
  if (!profile) return { status: 400, error: "Unknown or inactive role profile" };

  const params: SendParams = {
    orgId: args.orgId,
    userId: args.userId,
    roleProfileId: args.input.roleProfileId,
    baseUrl: args.baseUrl,
    locale: args.input.locale,
    expiresInDays: args.input.expiresInDays ?? null,
    message: args.input.message ?? null,
    batchId: null,
  };
  const result = await createOne(
    params,
    { email: args.input.email, name: args.input.name ?? null },
    profile
  );
  if (result.outcome === "skipped") {
    return { status: 409, error: "An open invitation for this candidate and role already exists" };
  }
  return { status: 201, result };
}

export type BulkResult =
  | {
      status: 200;
      batchId: string;
      results: RecipientResult[];
      summary: { sent: number; created: number; skipped: number; failed: number };
    }
  | { status: 400; error: string };

/** Bulk send (UI-SPEC D.5 "Bulk"). One batchId; per-recipient results. */
export async function createInvitationsBulk(args: {
  orgId: string;
  userId: string;
  baseUrl: string;
  input: {
    roleProfileId: string;
    recipients: RecipientInput[];
    expiresInDays?: number | null;
    locale: "en" | "ar";
    message?: string | null;
  };
}): Promise<BulkResult> {
  const profile = await activeRoleProfile(args.orgId, args.input.roleProfileId);
  if (!profile) return { status: 400, error: "Unknown or inactive role profile" };

  // Dedupe the batch defensively (the client parser already does, but the API is
  // the boundary). First occurrence wins.
  const seen = new Set<string>();
  const unique = args.input.recipients.filter((r) => {
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });

  const batchId = generateInvitationToken().slice(0, 24);
  const params: SendParams = {
    orgId: args.orgId,
    userId: args.userId,
    roleProfileId: args.input.roleProfileId,
    baseUrl: args.baseUrl,
    locale: args.input.locale,
    expiresInDays: args.input.expiresInDays ?? null,
    message: args.input.message ?? null,
    batchId,
  };

  // Sequential: each create is audited (no unaudited bulk write) and email send is
  // I/O-bound; the batch is bounded by MAX_BATCH so this stays well-behaved.
  const results: RecipientResult[] = [];
  for (const r of unique) {
    results.push(await createOne(params, r, profile));
  }

  const summary = {
    sent: results.filter((r) => r.outcome === "sent").length,
    created: results.filter((r) => r.outcome === "created").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };
  return { status: 200, batchId, results, summary };
}

// ---- Resend (rotate the token) / Revoke ----

export type ActionResult =
  | { status: 200; result?: RecipientResult }
  | { status: 404 | 409 | 502 | 503; error: string };

/**
 * Resend (UI-SPEC D.5). ROTATES the token — the old link dies, a fresh one is
 * emailed (consistent with hash-at-rest: we never stored the old raw token to
 * resend it). Only meaningful before the candidate engaged or after expiry; a
 * STARTED/COMPLETED/REVOKED invite is not resent (409) so an in-progress or
 * finished sitting is never disrupted.
 *
 * Token rotation is committed BEFORE the email send (the link only resolves once
 * the new hash is persisted). If delivery then fails — the transport throws OR
 * email is disabled (`sent:false`) — we'd be left with a dead old link and an
 * undelivered new one, so the candidate would have NO working link while the
 * list still showed them as invited. To avoid that we snapshot the prior state
 * and REVERT it on any non-delivery (non-atomic, but it restores the previous
 * link as a fallback) and return 502 so the caller surfaces a real failure
 * instead of a silent success (senior-review MEDIUM, 2026-06-27).
 */
export async function resendInvitation(args: {
  orgId: string;
  id: string;
  baseUrl: string;
  /** The admin performing the resend — becomes the new `sentById` on success. */
  userId: string;
}): Promise<ActionResult> {
  const inv = await prisma.invitation.findFirst({
    where: { id: args.id, orgId: args.orgId },
    select: {
      id: true,
      candidateEmail: true,
      candidateName: true,
      status: true,
      expiresAt: true,
      locale: true,
      tokenHash: true,
      sentById: true,
      roleProfile: { select: { title: true, org: { select: { name: true } } } },
    },
  });
  if (!inv) return { status: 404, error: "Invitation not found" };

  if (
    inv.status === InvitationStatus.STARTED ||
    inv.status === InvitationStatus.COMPLETED ||
    inv.status === InvitationStatus.REVOKED
  ) {
    return {
      status: 409,
      error:
        inv.status === InvitationStatus.STARTED
          ? "This candidate has already started — resend would disrupt the sitting"
          : `Cannot resend a ${inv.status.toLowerCase()} invitation`,
    };
  }

  // Pre-check the transport: a resend that can never be delivered (no Resend /
  // SMTP configured) must NOT rotate the token — that would kill the prior link
  // for no gain and leave the candidate stranded. Fail clearly instead of doing
  // a pointless rotate+revert (and emitting two misleading audit rows) on a
  // deterministic config state.
  if (!isEmailEnabled()) {
    return {
      status: 503,
      error:
        "Email delivery is not configured on this deployment, so invitations can't be resent.",
    };
  }

  // Snapshot the prior state so a failed delivery can be reverted (keeps the
  // previous link alive rather than stranding the candidate).
  const prior = {
    tokenHash: inv.tokenHash,
    status: inv.status,
    expiresAt: inv.expiresAt,
    sentById: inv.sentById,
  };

  const rawToken = generateInvitationToken();
  // If the link had already expired, clear the stale expiry so the resent link
  // works; a still-future expiry is preserved.
  const expiresAt =
    inv.expiresAt && inv.expiresAt.getTime() < Date.now() ? null : inv.expiresAt;

  await prisma.invitation.update({
    where: { id: inv.id },
    data: {
      tokenHash: hashInvitationToken(rawToken),
      status: InvitationStatus.PENDING,
      expiresAt,
      sentById: args.userId,
    },
  });

  const link = `${args.baseUrl}/a/${rawToken}`;
  let delivered = false;
  try {
    const res = await sendInvitationEmail({
      to: inv.candidateEmail,
      candidateName: inv.candidateName,
      roleTitle: inv.roleProfile.title,
      orgName: inv.roleProfile.org.name,
      link,
      locale: inv.locale === "ar" ? "ar" : "en",
      message: null,
    });
    delivered = res.sent;
  } catch {
    delivered = false;
  }

  if (delivered) {
    return {
      status: 200,
      result: { email: inv.candidateEmail, outcome: "sent" },
    };
  }

  // Delivery failed at runtime (transport threw). Roll the rotation back so the
  // prior link/state survives. The revert is itself guarded: if it ALSO fails,
  // the rotation has stuck (new undelivered link is live, old link dead) — say
  // so honestly and tell the operator to resend, which re-rotates and retries
  // the send rather than leaving them to guess from a generic 500.
  try {
    await prisma.invitation.update({
      where: { id: inv.id },
      data: {
        tokenHash: prior.tokenHash,
        status: prior.status,
        expiresAt: prior.expiresAt,
        sentById: prior.sentById,
      },
    });
  } catch {
    return {
      status: 502,
      error:
        "Sending the invitation email failed and the previous link could not be restored. Please resend to issue a fresh link.",
    };
  }

  return {
    status: 502,
    error:
      "Could not send the invitation email — the invitation is unchanged. Check email delivery and try again.",
  };
}

/** Revoke (UI-SPEC D.5). Sets REVOKED → resolveToken maps it to a 403 for the
 * candidate. A COMPLETED sitting can't be revoked (the data already exists); an
 * already-REVOKED one is a no-op 409. */
export async function revokeInvitation(args: {
  orgId: string;
  id: string;
}): Promise<ActionResult> {
  const inv = await prisma.invitation.findFirst({
    where: { id: args.id, orgId: args.orgId },
    select: { id: true, status: true },
  });
  if (!inv) return { status: 404, error: "Invitation not found" };
  if (inv.status === InvitationStatus.COMPLETED) {
    return { status: 409, error: "Cannot revoke a completed assessment" };
  }
  if (inv.status === InvitationStatus.REVOKED) {
    return { status: 409, error: "Invitation is already revoked" };
  }
  await prisma.invitation.update({
    where: { id: inv.id },
    data: { status: InvitationStatus.REVOKED },
  });
  return { status: 200 };
}

// ---- OPENED beacon (candidate runner, token-authorized) ----

/** Idempotently mark a PENDING invitation OPENED (candidate loaded the link). */
export async function markOpened(invitation: {
  id: string;
  status: InvitationStatus;
}): Promise<void> {
  if (invitation.status === InvitationStatus.PENDING) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.OPENED },
    });
  }
}

// ---- Email (bilingual; metadata-only logging via lib/email.ts) ----

function sendInvitationEmail(opts: {
  to: string;
  candidateName: string | null;
  roleTitle: string;
  orgName: string;
  link: string;
  locale: "en" | "ar";
  message: string | null;
}): Promise<SendEmailResult> {
  const ar = opts.locale === "ar";
  const greetName = opts.candidateName ? ` ${opts.candidateName}` : "";

  const subject = ar
    ? `دعوة لإكمال تقييم ${opts.roleTitle}`
    : `Your invitation to the ${opts.roleTitle} assessment`;

  const lines = ar
    ? [
        `مرحبًا${greetName}،`,
        ``,
        `دعتك ${opts.orgName} لإكمال تقييم قصير لوظيفة «${opts.roleTitle}».`,
        opts.message ? `\n${opts.message}\n` : ``,
        `للبدء، افتح الرابط التالي:`,
        opts.link,
        ``,
        `يستغرق التقييم حوالي ٢٠–٢٥ دقيقة، ويمكنك الحفظ والمتابعة لاحقًا عبر الرابط نفسه.`,
      ]
    : [
        `Hello${greetName},`,
        ``,
        `${opts.orgName} has invited you to complete a short assessment for the "${opts.roleTitle}" role.`,
        opts.message ? `\n${opts.message}\n` : ``,
        `To begin, open your personal link:`,
        opts.link,
        ``,
        `It takes about 20–25 minutes. You can save and resume later via the same link.`,
      ];

  const text = lines.filter((l) => l !== ``).join("\n");

  return sendEmail({ to: opts.to, subject, text });
}

function dbReason(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `db-${e.code}`;
  return "db-error";
}
