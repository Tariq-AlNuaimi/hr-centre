import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateCustomFieldDefSchema } from "@/lib/validations/custom-field";

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const record = await prisma.customFieldDef.findUnique({ where: { id } });
    if (!record) return notFound("Custom field");
    return ok(record);
  }),
  { id: "custom-field-def-read", limit: 120, windowMs: 60000 },
);

export const PUT = withRateLimit(
  withAdminAuth(async (request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = updateCustomFieldDefSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const existing = await prisma.customFieldDef.findUnique({ where: { id } });
    if (!existing) return notFound("Custom field");
    const updated = await prisma.customFieldDef.update({ where: { id }, data: parsed.data });
    return ok(updated);
  }),
  { id: "custom-field-def-write", limit: 30, windowMs: 60000 },
);

export const DELETE = withRateLimit(
  withAdminAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const existing = await prisma.customFieldDef.findUnique({ where: { id } });
    if (!existing) return notFound("Custom field");
    await prisma.customFieldDef.delete({ where: { id } });
    return ok({ id });
  }),
  { id: "custom-field-def-write", limit: 30, windowMs: 60000 },
);
