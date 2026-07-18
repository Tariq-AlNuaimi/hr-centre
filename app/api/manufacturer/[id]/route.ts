import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateManufacturerSchema } from "@/lib/validations/manufacturer";

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const record = await prisma.manufacturer.findUnique({ where: { id } });
    if (!record) return notFound("Manufacturer");
    return ok(record);
  }),
  { id: "manufacturer-read", limit: 120, windowMs: 60000 },
);

export const PUT = withRateLimit(
  withEditorAuth(async (request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = updateManufacturerSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const existing = await prisma.manufacturer.findUnique({ where: { id } });
    if (!existing) return notFound("Manufacturer");
    const updated = await prisma.manufacturer.update({
      where: { id },
      data: parsed.data,
    });
    return ok(updated);
  }),
  { id: "manufacturer-write", limit: 30, windowMs: 60000 },
);

export const DELETE = withRateLimit(
  withEditorAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const existing = await prisma.manufacturer.findUnique({ where: { id } });
    if (!existing) return notFound("Manufacturer");
    await prisma.manufacturer.delete({ where: { id } });
    return ok({ id });
  }),
  { id: "manufacturer-write", limit: 30, windowMs: 60000 },
);
