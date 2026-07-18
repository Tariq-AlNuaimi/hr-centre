import { z } from "zod";
export const createAssetModelSchema = z.object({
  name: z.string().min(1).max(255),
  categoryId: z.string().min(1),
  manufacturerId: z.string().min(1),
});

export const updateAssetModelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export type CreateAssetModelInput = z.infer<typeof createAssetModelSchema>;
export type UpdateAssetModelInput = z.infer<typeof updateAssetModelSchema>;
