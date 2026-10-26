import { z } from "zod";
import { ESCALATION_QUESTION_MAX } from "./escalation";

/**
 * ADR-070's follow-up, bounded at the boundary (AC-9.5).
 *
 * This arrives on an UNAUTHENTICATED route holding a bearer token, so the body
 * is hostile input from someone who may or may not be the employee the token was
 * minted for. The bound is the same one an ordinary chat message gets: a
 * follow-up is a question, and there is no reason it should be allowed to be
 * larger than the question that started the escalation.
 *
 * @public
 */
export const replyBodySchema = z.object({
  body: z.string().trim().min(1).max(ESCALATION_QUESTION_MAX),
});

/**
 * The token as it arrives in the path: 32 bytes of CSPRNG output as base64url,
 * which is exactly 43 characters. Bounded here as well as in
 * `lib/hive/reply-token.ts` so a megabyte of path never reaches a hash.
 */
export const replyTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
