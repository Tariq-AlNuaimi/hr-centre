import { z } from "zod";
import type { CustomFieldType } from "@/generated/prisma/client";

// Admin-defined custom field definition (T9). `key` is the JSON key stored in
// `Asset.customFields`; kept snake_case so it's a stable, safe object key.
export const createCustomFieldDefSchema = z.object({
  label: z.string().min(1).max(255),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lower snake_case"),
  type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]),
  required: z.boolean().optional(),
});

export type CreateCustomFieldDefInput = z.infer<typeof createCustomFieldDefSchema>;

// `key` is immutable after create (it is the JSON key already stored on assets) — omitted.
export const updateCustomFieldDefSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]).optional(),
  required: z.boolean().optional(),
});

export type CustomFieldDefLite = {
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
};

/**
 * Validate a submitted `customFields` value object at the API boundary against the
 * active defs: enforce `required`, coerce per `type`, and reject any key that isn't a
 * defined field (so the stored JSON can't accumulate arbitrary keys). Returns the
 * coerced value on success or a human message on failure.
 */
export function validateCustomFields(
  defs: CustomFieldDefLite[],
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};

  for (const def of defs) {
    const v = input[def.key];
    if (v === undefined || v === null || v === "") {
      if (def.required) return { ok: false, error: `${def.label} is required` };
      continue;
    }
    switch (def.type) {
      case "NUMBER": {
        const n = Number(v);
        if (Number.isNaN(n)) return { ok: false, error: `${def.label} must be a number` };
        out[def.key] = n;
        break;
      }
      case "BOOLEAN":
        out[def.key] = Boolean(v);
        break;
      case "DATE": {
        const d = new Date(v as string);
        if (Number.isNaN(d.getTime())) return { ok: false, error: `${def.label} must be a date` };
        out[def.key] = String(v);
        break;
      }
      default:
        out[def.key] = String(v);
    }
  }

  for (const k of Object.keys(input)) {
    if (!defs.some((d) => d.key === k)) return { ok: false, error: `Unknown custom field: ${k}` };
  }
  return { ok: true, value: out };
}
