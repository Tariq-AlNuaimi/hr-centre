import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateAssetModelSchema } from "@/lib/validations/asset-model";

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const record = await prisma.assetModel.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        manufacturer: { select: { id: true, name: true } },
      },
    });
    if (!record) return notFound("AssetModel");
    return ok(record);
  }),
  { id: "asset-model-read", limit: 120, windowMs: 60000 },
);

export const PUT = withRateLimit(
  withEditorAuth(async (request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = updateAssetModelSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const existing = await prisma.assetModel.findUnique({ where: { id } });
    if (!existing) return notFound("AssetModel");
    const updated = await prisma.assetModel.update({
      where: { id },
      data: parsed.data,
    });
    return ok(updated);
  }),
  { id: "asset-model-write", limit: 30, windowMs: 60000 },
);

export const DELETE = withRateLimit(
  withEditorAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const existing = await prisma.assetModel.findUnique({ where: { id } });
    if (!existing) return notFound("AssetModel");
    await prisma.assetModel.delete({ where: { id } });
    return ok({ id });
  }),
  { id: "asset-model-write", limit: 30, windowMs: 60000 },
);
