import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateCategorySchema } from "@/lib/validations/category";

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const record = await prisma.category.findUnique({ where: { id } });
    if (!record) return notFound("Category");
    return ok(record);
  }),
  { id: "category-read", limit: 120, windowMs: 60000 },
);

export const PUT = withRateLimit(
  withEditorAuth(async (request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return notFound("Category");
    const updated = await prisma.category.update({
      where: { id },
      data: parsed.data,
    });
    return ok(updated);
  }),
  { id: "category-write", limit: 30, windowMs: 60000 },
);

export const DELETE = withRateLimit(
  withEditorAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return notFound("Category");
    await prisma.category.delete({ where: { id } });
    return ok({ id });
  }),
  { id: "category-write", limit: 30, windowMs: 60000 },
);
