import { z } from "zod";
import { emailSchema } from "./common";

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("VIEWER"),
});

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  password: z.string().min(8).max(128).optional(), // min 8 matches createUserSchema + the self-service route
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
