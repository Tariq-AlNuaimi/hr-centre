import { z } from "zod";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_COMMENT,
  MAX_EVIDENCE_LABEL,
} from "@/lib/pms/evidence";

/**
 * §7.1 evidence — the boundary schemas.
 *
 * zod bounds the SHAPE; `lib/pms/evidence.ts` decides the RULES. The split
 * matters: the rules are also consulted by the sign-off gate and the delete
 * route, and a rule that lived only in a request schema would apply to exactly
 * one caller.
 */

/** Attaching a link. Scheme is re-checked by `linkBlockedReason`. */
export const attachLinkSchema = z.object({
  kpiId: z.string().min(1),
  label: z.string().trim().min(1).max(MAX_EVIDENCE_LABEL),
  url: z.string().trim().min(1).max(2_000),
});

/**
 * Asking for an upload token.
 *
 * The size and type are DECLARED here and enforced twice: once now, so an
 * oversized file is refused before a byte is sent, and again by the token
 * itself (`maximumSizeInBytes` / `allowedContentTypes`), so a client that lies
 * to this route still cannot complete the upload.
 */
export const uploadTokenSchema = z.object({
  kpiId: z.string().min(1),
  label: z.string().trim().min(1).max(MAX_EVIDENCE_LABEL),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(
    Object.keys(ALLOWED_EVIDENCE_TYPES) as [string, ...string[]],
    "That file type is not accepted.",
  ),
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
});

/**
 * The browser reporting that the bytes landed.
 *
 * `pathname` is the one field here the server does not take on trust: it is
 * re-checked against the authorised KPI's prefix, refused if another row
 * already claims it, and the bytes behind it are read back and sniffed before a
 * row exists. `sizeBytes` is only a fallback — the recorded size comes from the
 * stored object's own `Content-Range` where storage reports one.
 */
export const confirmUploadSchema = z.object({
  kpiId: z.string().min(1),
  pathname: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(MAX_EVIDENCE_LABEL),
  contentType: z.enum(
    Object.keys(ALLOWED_EVIDENCE_TYPES) as [string, ...string[]],
    "That file type is not accepted.",
  ),
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
});

/**
 * Asking permission BEFORE any bytes move, and asking where to put them.
 *
 * Same fields the token request declares, because it answers the same question
 * — the point is that the answer comes back as our own `{ error, status }`
 * rather than through the Blob SDK, which replaces our sentence with its own.
 */
export const uploadPreflightSchema = z.object({
  preflight: z.literal(true),
  kpiId: z.string().min(1),
  contentType: z.enum(
    Object.keys(ALLOWED_EVIDENCE_TYPES) as [string, ...string[]],
    "That file type is not accepted.",
  ),
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
});

/** The manager's note on one item. */
export const evidenceCommentSchema = z.object({
  comment: z.string().trim().min(1).max(MAX_EVIDENCE_COMMENT),
});
