import { z } from "zod";

/** Boundary validation for logins — blueprint §4 (F-d). */

export const issueLoginSchema = z.object({
  action: z.enum(["create", "reset"], { message: "action: use create or reset" }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current (temporary) password").max(128),
    newPassword: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128, "Keep it under 128 characters"),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Choose a password different from the temporary one",
    path: ["newPassword"],
  });
