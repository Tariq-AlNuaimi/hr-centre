import { z } from "zod";

// SCIM directory-event validation (ADR-045 amendment A4, WS-6). `lib/sso/scim.ts`
// `normalizeDirectoryEvent` adapts the provider-specific BoxyHQ dsync shape and
// decides what to SKIP (group/membership/emailless events → null → 200 skipped).
// This schema is the API-boundary validator applied to the NORMALIZED event before
// it touches the DB — the CLAUDE.md hard rule "validate at the API boundary with
// zod." The key guarantee the hand-rolled guards did NOT give: the address is a
// real email (`.email()`), so a malformed value can't land in `users.email`; a
// non-conforming event is a 400, not a silently-provisioned bad row.

export const normalizedScimEventSchema = z.object({
  type: z.enum(["user.created", "user.updated", "user.deleted"]),
  email: z.string().email(),
  name: z.string().nullable(),
  active: z.boolean(),
  externalId: z.string().nullable(),
});

export type NormalizedScimEventInput = z.infer<typeof normalizedScimEventSchema>;
