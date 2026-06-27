import { z } from "zod";

// Zod contracts for Phase-5 invitations (ARCHITECTURE §12.5, UI-SPEC D.5). Parsed
// at the API boundary (CLAUDE.md "validate at the API boundary with zod"). The
// recipient parser (parseRecipients) is client-safe (zod-only, no Prisma) so the
// send panel can preview paste/CSV input before it ever hits the server, and the
// bulk route re-validates the same shapes server-side.

// A bulk send is bounded (Pillar 4: scalable — no unbounded fan-out of emails +
// writes in one request). 500 covers a realistic hiring round; bigger needs a job.
export const MAX_BATCH = 500;

// Client-safe mirror of the Prisma InvitationStatus enum values (UI-SPEC D.5
// statuses). Lives here (zod-only module) so "use client" components — the status
// filter — can list them WITHOUT importing the Prisma runtime client (which pulls
// node:module into the browser bundle). Kept in lockstep with schema.prisma.
export const INVITATION_STATUSES = [
  "PENDING",
  "OPENED",
  "STARTED",
  "COMPLETED",
  "EXPIRED",
  "REVOKED",
] as const;
export type InvitationStatusName = (typeof INVITATION_STATUSES)[number];

// Per-recipient send outcome (client-safe: defined here, not in the service, so the
// send panel can type its results without importing a Prisma-bound module). 'sent'
// = invite created + email delivered; 'created' = created, email disabled (SMTP
// unset); 'skipped' = an open invite for this email+role already exists; 'failed' =
// the create/send errored.
export type RecipientOutcome = "sent" | "created" | "skipped" | "failed";
export type RecipientResult = {
  email: string;
  outcome: RecipientOutcome;
  reason?: string;
};

// Lowercased, trimmed email. Reused for single + each bulk recipient.
const emailSchema = z.string().trim().toLowerCase().email();

// Candidate display name (optional; email is the identity key).
const nameSchema = z.string().trim().max(200).optional().nullable();

// Expiry expressed as whole days from send (1..365), or null = no expiry. The send
// route converts this to an absolute expiresAt. Bounded so a typo can't set a
// decade-long link.
const expiresInDaysSchema = z.number().int().min(1).max(365).nullable().optional();

// Candidate-facing default language (the candidate can still switch — UI-SPEC C.5).
const localeSchema = z.enum(["en", "ar"]).default("en");

// Optional custom message included in the invite email body.
const messageSchema = z.string().trim().max(2000).optional().nullable();

// ---- Single send (UI-SPEC D.5 "Single") ----
export const singleInvitationSchema = z.object({
  roleProfileId: z.string().cuid(),
  email: emailSchema,
  name: nameSchema,
  expiresInDays: expiresInDaysSchema,
  locale: localeSchema,
  message: messageSchema,
});
export type SingleInvitationInput = z.infer<typeof singleInvitationSchema>;

// One recipient of a bulk send (already parsed client-side; re-validated here).
export const recipientSchema = z.object({
  email: emailSchema,
  name: nameSchema,
});
export type RecipientInput = z.infer<typeof recipientSchema>;

// ---- Bulk send (UI-SPEC D.5 "Bulk") ----
export const bulkInvitationSchema = z.object({
  roleProfileId: z.string().cuid(),
  recipients: z.array(recipientSchema).min(1).max(MAX_BATCH),
  expiresInDays: expiresInDaysSchema,
  locale: localeSchema,
  message: messageSchema,
});
export type BulkInvitationInput = z.infer<typeof bulkInvitationSchema>;

// ---- Client-safe recipient parser (paste OR CSV) ----
//
// Used by the send panel to preview, and re-runnable server-side. Rules:
//   - Split on newlines into rows. A row with a comma is a CSV record
//     (email,name); the first field is the email, the rest joins as the name.
//   - A SINGLE line with no newlines is treated as a comma/semicolon-separated
//     EMAIL list (the "paste a few emails" case). (A lone "email,name" line is
//     ambiguous; the second token simply fails email validation and is flagged.)
//   - A leading header row (`email`/`e-mail` in field 0) is skipped.
//   - Emails are lowercased + deduped (first wins, keeping its name); invalid
//     tokens and intra-batch duplicates are reported, never silently dropped.

export type ParsedRecipient = { email: string; name?: string };
export type RecipientParse = {
  recipients: ParsedRecipient[]; // valid + deduped, in first-seen order
  invalid: string[]; // raw tokens that failed email validation
  duplicates: number; // count removed as duplicates of an earlier valid row
  total: number; // rows considered (excludes blanks + header)
};

// A pragmatic email check for the client preview; the server re-validates with
// zod's .email() (recipientSchema) so this is a fast filter, not the source of
// truth. Deliberately simple (no exotic RFC cases) to match user expectation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(raw: string): RecipientParse {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Build the raw record list (each: [emailToken, nameOrUndefined]).
  let records: Array<{ emailToken: string; name?: string }> = [];
  if (lines.length <= 1) {
    const single = lines[0] ?? "";
    const parts = single
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Disambiguate a lone "email,name" line from a comma-separated email list: if
    // there are exactly two parts and the second is NOT an email while the first
    // IS, treat it as one email+name record (don't flag the name as invalid).
    if (parts.length === 2 && EMAIL_RE.test(parts[0]) && !EMAIL_RE.test(parts[1])) {
      records = [{ emailToken: parts[0], name: parts[1] }];
    } else {
      records = parts.map((emailToken) => ({ emailToken }));
    }
  } else {
    records = lines.map((line) => {
      const idx = line.indexOf(",");
      if (idx === -1) return { emailToken: line };
      const emailToken = line.slice(0, idx).trim();
      const name = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
      return { emailToken, name: name || undefined };
    });
  }

  // Skip a header row (e.g. "email,name").
  if (records.length > 0) {
    const head = records[0].emailToken.toLowerCase();
    if (head === "email" || head === "e-mail" || head === "emails") {
      records = records.slice(1);
    }
  }

  const recipients: ParsedRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rec of records) {
    const email = rec.emailToken.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid.push(rec.emailToken);
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    recipients.push({ email, name: rec.name });
  }

  return { recipients, invalid, duplicates, total: records.length };
}
