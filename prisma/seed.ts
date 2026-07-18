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

    // ITAM demo hierarchy (T2) — Category / Manufacturer / AssetModel, all idempotent
    // (findUnique-then-create; `upsert` would trip no-unaudited-bulk-write). The seed uses
    // the RAW generated client (no audit/soft-delete extension), so plain creates are fine.
    async function ensureCategory(name: string) {
      return (
        (await prisma.category.findUnique({ where: { name } })) ??
        (await prisma.category.create({ data: { name } }))
      );
    }
    async function ensureManufacturer(name: string) {
      return (
        (await prisma.manufacturer.findUnique({ where: { name } })) ??
        (await prisma.manufacturer.create({ data: { name } }))
      );
    }
    async function ensureModel(name: string, categoryId: string, manufacturerId: string) {
      return (
        (await prisma.assetModel.findUnique({
          where: { manufacturerId_name: { manufacturerId, name } },
        })) ?? (await prisma.assetModel.create({ data: { name, categoryId, manufacturerId } }))
      );
    }

    const [laptop, monitor, phone] = await Promise.all([
      ensureCategory("Laptop"),
      ensureCategory("Monitor"),
      ensureCategory("Phone"),
    ]);
    const [apple, dell, lenovo] = await Promise.all([
      ensureManufacturer("Apple"),
      ensureManufacturer("Dell"),
      ensureManufacturer("Lenovo"),
    ]);
    const models = await Promise.all([
      ensureModel("MacBook Pro 14", laptop.id, apple.id),
      ensureModel("ThinkPad X1 Carbon", laptop.id, lenovo.id),
      ensureModel("UltraSharp U2723QE", monitor.id, dell.id),
      ensureModel("iPhone 15", phone.id, apple.id),
    ]);
    console.log(`Seeded ${models.length} demo asset models across the ITAM hierarchy.`);

    // A few demo assets linked to models, idempotent by the unique assetTag.
    const demoAssets = [
      { assetTag: "LAP-0001", name: "Design lead laptop", modelId: models[0].id },
      { assetTag: "LAP-0002", name: "Backend dev laptop", modelId: models[1].id },
      { assetTag: "MON-0001", name: "Standup display", modelId: models[2].id },
    ];
    for (const a of demoAssets) {
      const found = await prisma.asset.findUnique({ where: { assetTag: a.assetTag } });
      if (!found) await prisma.asset.create({ data: a });
    }
    console.log(`Seeded ${demoAssets.length} demo assets.`);

    // Demo custom-field definitions (T9), idempotent by key.
    const demoDefs = [
      { label: "Warranty expiry", key: "warranty_expiry", type: "DATE" as const, required: false },
      { label: "Cost center", key: "cost_center", type: "TEXT" as const, required: false },
    ];
    for (const d of demoDefs) {
      const found = await prisma.customFieldDef.findUnique({ where: { key: d.key } });
      if (!found) await prisma.customFieldDef.create({ data: d });
    }
    console.log(`Seeded ${demoDefs.length} custom-field definitions.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
