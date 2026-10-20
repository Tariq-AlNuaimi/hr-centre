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

/** The manager's note on one item. */
export const evidenceCommentSchema = z.object({
  comment: z.string().trim().min(1).max(MAX_EVIDENCE_COMMENT),
});
