import { z } from "zod";
export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
