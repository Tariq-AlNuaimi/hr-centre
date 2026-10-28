import { z } from "zod";

/** JML task routing — the desk member lists (Admin › Settings › Joiners & leavers). */

const userIds = z
  .array(z.string().trim().min(1).max(64))
  .max(50, "A desk can list at most 50 people")
  .transform((ids) => [...new Set(ids)]);

export const deskSettingsSchema = z.object({ IT: userIds, FINANCE: userIds }).strict();

export type DeskSettingsInput = z.infer<typeof deskSettingsSchema>;
