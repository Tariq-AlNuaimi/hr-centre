import { z } from "zod";

const id = z.string().min(1).max(64);

export const createPlanningRoundSchema = z.object({
  entityId: id,
  label: z.string().trim().min(1, "A cycle label is required").max(80),
  openedAt: z.coerce.date().optional(),
});

export const updatePlanningRoundSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["OPEN", "CLOSED"]).optional(),
  })
  .refine((v) => v.label !== undefined || v.status !== undefined, "Nothing to change");

export const createNeedSchema = z.object({
  departmentId: id,
  ownerId: id.optional().nullable(),
});

export const updateNeedSchema = z
  .object({
    status: z.enum(["ASKED", "NO_RESPONSE", "SUBMITTED", "CHALLENGE_AGREED", "NO_NEED"]).optional(),
    ownerId: id.optional().nullable(),
    rolesRequested: z.number().int().min(0).max(999).optional().nullable(),
    agreedRoles: z.number().int().min(0).max(999).optional().nullable(),
  })
  .refine(
    (v) => v.rolesRequested == null || v.agreedRoles == null || v.agreedRoles <= v.rolesRequested,
    {
      message: "The challenge cannot agree more roles than the department asked for",
      path: ["agreedRoles"],
    },
  )
  .refine(
    (v) =>
      v.status !== "CHALLENGE_AGREED" ||
      v.agreedRoles !== undefined ||
      v.rolesRequested !== undefined,
    { message: "Record how many roles the challenge agreed", path: ["agreedRoles"] },
  )
  .refine((v) => v.status !== "SUBMITTED" || v.rolesRequested != null, {
    message: "Record how many roles the department asked for",
    path: ["rolesRequested"],
  });

export const createNeedNoteSchema = z.object({
  body: z.string().trim().min(1, "Write a note before posting").max(2000),
});
