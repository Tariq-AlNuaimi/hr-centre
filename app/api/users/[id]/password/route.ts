import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api-helpers";
import { ok, err, forbidden } from "@/lib/api-response";
import { z } from "zod";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export const PUT = withAuth(async (
  request: NextRequest,
  { params, session }
) => {
  const { id } = await params;

  // Users can only change their own password
  if (id !== session.user.id) return forbidden();

  const body = await request.json();
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return err("Password change not available for OAuth accounts");
  }

  const valid = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!valid) return err("Current password is incorrect", 403);

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  return ok({ changed: true });
});
