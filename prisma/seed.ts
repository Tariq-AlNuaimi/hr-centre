import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase().trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme";

  // Refuse to seed a guessable admin into a real deployment. The default
  // password is fine for local dev, but in production it would ship a
  // publicly-known ADMIN credential. Fail loudly instead.
  if (process.env.NODE_ENV === "production" && adminPassword === "changeme") {
    console.error(
      "Refusing to seed: SEED_ADMIN_PASSWORD is unset in production " +
        "(would create admin@example.com / 'changeme'). Set a strong password and re-run."
    );
    process.exit(1);
  }

  // Always release the pool, whether we created the admin or skipped it.
  try {
    const existing = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existing) {
      console.log(`Admin user ${adminEmail} already exists, skipping seed.`);
      return;
    }

    const passwordHash = await hashPassword(adminPassword);

    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin",
        passwordHash,
        role: "ADMIN",
      },
    });

    console.log(`Admin user created: ${adminEmail}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
