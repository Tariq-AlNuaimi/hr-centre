import { z } from "zod";
import { NOTIFICATION_KINDS } from "@/lib/core/notify/registry";

/** A person's notification choices (ADR-095); mandatory kinds are ignored server-side. */
export const preferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        kind: z.enum(NOTIFICATION_KINDS as [string, ...string[]]),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .max(NOTIFICATION_KINDS.length),
});
