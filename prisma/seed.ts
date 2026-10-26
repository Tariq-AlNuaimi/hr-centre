import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";
import { seedFoundation } from "./seed-foundation";
import { seedPms } from "./seed-pms";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase().trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme";

  // Refuse to seed a guessable admin into a real deployment. The default
  // password is fine for local dev, but in production it would ship a
  // publicly-known ADMIN credential. Skip CLEANLY rather than erroring: this
  // seed runs in the Vercel build (vercel.json) where a non-zero exit is
  // swallowed by `|| echo 'seed skipped'` and is indistinguishable from a real
  // failure. A clean skip keeps that error-masking honest — only genuine seed
  // errors trip the fallback — and a fresh deploy with no SEED_ADMIN_PASSWORD
  // gets no admin (better than a known credential) instead of a silent crash.
  // /deploy sets SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD so the build DOES seed
  // the admin on the first deploy (#50/#51). (#51)
  if (process.env.NODE_ENV === "production" && adminPassword === "changeme") {
    console.warn(
      "Skipping admin seed: SEED_ADMIN_PASSWORD is unset in production " +
        "(would create admin@example.com / 'changeme'). Set SEED_ADMIN_EMAIL + " +
        "SEED_ADMIN_PASSWORD and redeploy to create the admin user.",
    );
    await prisma.$disconnect();
    return;
  }

  // Always release the pool, whether we created the admin or skipped it.
  try {
    const existing = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existing) {
      console.log(`Admin user ${adminEmail} already exists, skipping admin seed.`);
    } else {
      const passwordHash = await hashPassword(adminPassword);
      await prisma.user.create({
        data: { email: adminEmail, name: "Admin", passwordHash, role: "ADMIN" },
      });
      console.log(`Admin user created: ${adminEmail}`);
    }

    // HR Centre starts empty: companies, the bootstrap HR department and the
    // bootstrap HR Super Admin only (prisma/seed-foundation.ts). Runs on every
    // deploy via vercel.json, so it must stay idempotent.
    await seedFoundation(prisma);

    // The 36-person demo fixture is for local development only. It never runs
    // unless asked for explicitly, so a real deployment holds no invented people.
    if (process.env.SEED_DEMO === "1") await seedPms(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
