import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateAssetSchema, isLegalStatusTransition } from "@/lib/validations/asset";
import { validateCustomFields } from "@/lib/validations/custom-field";
import type { Prisma } from "@/generated/prisma/client";

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const record = await prisma.asset.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, name: true } },
        model: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
            manufacturer: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!record) return notFound("Asset");
    return ok(record);
  }),
  { id: "asset-read", limit: 120, windowMs: 60000 },
);

export const PUT = withRateLimit(
  withEditorAuth(async (request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = updateAssetSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) return notFound("Asset");
    // US4 / ADR-059: reject an illegal status lifecycle move (e.g. RETIRED → ASSIGNED).
    if (parsed.data.status && !isLegalStatusTransition(existing.status, parsed.data.status)) {
      return err(`Illegal status transition: ${existing.status} → ${parsed.data.status}`);
    }

    // Validate custom-field VALUES against the active defs (T9) when the payload sets them.
    const { customFields, ...rest } = parsed.data;
    const data: Prisma.AssetUpdateInput = { ...rest };
    if (customFields !== undefined) {
      const defs = await prisma.customFieldDef.findMany({
        select: { key: true, label: true, type: true, required: true },
        take: 500, // CustomFieldDef is a small admin-bounded set; bound defensively.
      });
      const cf = validateCustomFields(defs, customFields);
      if (!cf.ok) return err(cf.error);
      data.customFields = cf.value as Prisma.InputJsonValue;
    }

    const updated = await prisma.asset.update({ where: { id }, data });
    return ok(updated);
  }),
  { id: "asset-write", limit: 30, windowMs: 60000 },
);

export const DELETE = withRateLimit(
  withEditorAuth(async (_request: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) return notFound("Asset");
    await prisma.asset.delete({ where: { id } });
    return ok({ id });
  }),
  { id: "asset-write", limit: 30, windowMs: 60000 },
);
