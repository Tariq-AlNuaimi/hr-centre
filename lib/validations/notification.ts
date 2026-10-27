import { z } from "zod";

/**
 * The read side of the in-app notification feed (§5.5's second channel).
 *
 * Both schemas are `strictObject`, which is not decoration. zod's default is to
 * STRIP unknown keys, so a client posting a field the server does not know gets
 * a 200 and the silent opposite of what it asked for — the exact defect ADR-070
 * found in `createUserSchema`, where `{"role":"ADMIN"}` returned 201 and created
 * a VIEWER. `strictObject` turns that into a 400.
 */

/** Cap on ids per mark-read call. A popover shows twenty; nothing needs more. */
export const MAX_MARK_READ_IDS = 50;

export const markReadSchema = z
  .strictObject({
    /** Specific notifications — what clicking a row sends. */
    ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_MARK_READ_IDS).optional(),
    /** The "mark all read" button. Scoped server-side to the caller, always. */
    all: z.boolean().optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.all === true), {
    // Exactly one, because the two branches take different code paths (a bounded
    // per-row update vs. an audited bulk update). Accepting both would leave the
    // server choosing, and a client that sent both would not know which it got.
    message: "Send either `ids` or `all: true`, not both and not neither.",
  });
