import { z } from "zod";
export const createManufacturerSchema = z.object({
  name: z.string().min(1).max(255),
  website: z.string().min(1).max(255).optional(),
});

export const updateManufacturerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  website: z.string().min(1).max(255).optional(),
});

export type CreateManufacturerInput = z.infer<typeof createManufacturerSchema>;
export type UpdateManufacturerInput = z.infer<typeof updateManufacturerSchema>;
