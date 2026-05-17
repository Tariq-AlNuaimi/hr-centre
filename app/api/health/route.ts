import { NextResponse } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { checkStorageHealth } from "@/lib/storage";

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check
  try {
    await prismaUnfiltered.$queryRawUnsafe("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  // Storage check
  try {
    const ok = await checkStorageHealth();
    checks.storage = ok ? "ok" : "error";
  } catch {
    checks.storage = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
