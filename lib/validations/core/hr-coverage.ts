import { z } from "zod";

/** Admin › Settings › HR coverage (ADR-102) — one coverage row, as the screen saves it. */

const id = z.string().trim().min(1).max(64);
const nullableId = z
  .union([id, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const hrCoverageSchema = z
  .object({
    entityId: nullableId,
    directorateId: nullableId,
    departmentId: nullableId,
    teamId: nullableId,
    companyWide: z.boolean().default(false),
    pairId: nullableId,
    label: z.string().trim().max(120).default(""),
    aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    ownerUserId: nullableId,
    supervisorUserId: nullableId,
    caseTypes: z
      .array(z.enum(["JOIN", "MOVE", "LEAVE"]))
      .max(3)
      .default([]),
    priority: z.number().int().min(-1000).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => [v.directorateId, v.departmentId, v.teamId].filter(Boolean).length <= 1, {
    message: "Choose one unit: a directorate, a department or a team",
    path: ["departmentId"],
  })
  .refine((v) => Boolean(v.pairId) || Boolean(v.ownerUserId || v.supervisorUserId), {
    message: "Choose the HR pair tickets go to, or the case owner and supervisor, or both",
    path: ["pairId"],
  })
  .refine((v) => Boolean(v.ownerUserId) === Boolean(v.supervisorUserId), {
    message: "Choose both the case owner and the supervisor",
    path: ["supervisorUserId"],
  })
  .refine((v) => !v.pairId || v.label.length > 0, {
    message: "Give the words people use for this unit, so tickets can find it",
    path: ["label"],
  })
  .refine(
    (v) => !v.companyWide || (v.entityId && !v.directorateId && !v.departmentId && !v.teamId),
    {
      message: "A whole-company row names the company and no unit",
      path: ["companyWide"],
    },
  );

export type HrCoverageInput = z.output<typeof hrCoverageSchema>;
