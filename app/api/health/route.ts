import { NextResponse } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    await prismaUnfiltered.$queryRawUnsafe("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "error";
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
