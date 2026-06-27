import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";
import { IPIP_NEO_120 } from "./data/ipip-neo-120";

// Starter role families (ARCHITECTURE §5). Versioned RoleProfiles are authored
// under these in Phase 3; here we just seed the taxonomy so the org is usable.
const ROLE_FAMILIES: Array<{ key: string; name: string; description: string }> = [
  { key: "sales", name: "Sales / BD", description: "Achievement/drive, resilience, influence, relationship-building." },
  { key: "pmo", name: "PMO", description: "Organization & planning, stress tolerance, stakeholder judgement." },
  { key: "support", name: "Support", description: "Empathy, emotional regulation, follow-through, frustration tolerance." },
  { key: "legal_grc", name: "Legal / GRC", description: "Attention to detail, rule-orientation, low impulsivity, deliberation." },
  { key: "leadership", name: "Leadership", description: "Emotional stability, assertiveness, adaptability, cooperation under pressure." },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase().trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme";
  const orgName = process.env.SEED_ORG_NAME ?? "Rihal Group";
  const orgSlug = process.env.SEED_ORG_SLUG ?? "rihal";

  // Refuse to seed a guessable admin into a real deployment. The default
  // password is fine for local dev, but in production it would ship a
  // publicly-known HR_ADMIN credential. Skip CLEANLY rather than erroring: this
  // seed runs in the Vercel build (vercel.json) where a non-zero exit is
  // swallowed by `|| echo 'seed skipped'`. A clean skip keeps that honest.
  // /deploy sets SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD so the build DOES seed.
  if (process.env.NODE_ENV === "production" && adminPassword === "changeme") {
    console.warn(
      "Skipping admin seed: SEED_ADMIN_PASSWORD is unset in production " +
        "(would create admin@example.com / 'changeme'). Set SEED_ADMIN_EMAIL + " +
        "SEED_ADMIN_PASSWORD and redeploy to create the admin user."
    );
    await prisma.$disconnect();
    return;
  }

  try {
    // Tenant: upsert the org by its unique slug (idempotent).
    const org = await prisma.organization.upsert({
      where: { slug: orgSlug },
      update: {},
      create: { name: orgName, slug: orgSlug },
    });

    // Starter role-family taxonomy for the org (idempotent on (orgId, key)).
    for (const fam of ROLE_FAMILIES) {
      await prisma.roleFamily.upsert({
        where: { orgId_key: { orgId: org.id, key: fam.key } },
        update: { name: fam.name, description: fam.description },
        create: { orgId: org.id, ...fam },
      });
    }

    // Assessment item bank (ARCHITECTURE §12.2): the canonical IPIP-NEO-120
    // instrument. Global reference data (no orgId) -- one shared instrument for
    // every tenant. Idempotent upsert by the stable itemNumber, so re-seeding (or
    // the Vercel build re-running this) never duplicates and re-applies any
    // English-text corrections from the generated dataset WITHOUT clobbering an
    // HR-authored Arabic translation (text_ar is left untouched on update).
    for (const item of IPIP_NEO_120) {
      await prisma.assessmentItemBank.upsert({
        where: { itemNumber: item.itemNumber },
        update: {
          itemCode: item.itemCode,
          domain: item.domain,
          facet: item.facet,
          facetNumber: item.facetNumber,
          keyed: item.keyed,
          text_en: item.text_en,
        },
        create: {
          itemNumber: item.itemNumber,
          itemCode: item.itemCode,
          domain: item.domain,
          facet: item.facet,
          facetNumber: item.facetNumber,
          keyed: item.keyed,
          text_en: item.text_en,
        },
      });
    }
    console.log(`Assessment item bank seeded: ${IPIP_NEO_120.length} IPIP-NEO-120 items.`);

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      console.log(`Admin user ${adminEmail} already exists, skipping admin seed.`);
    } else {
      const passwordHash = await hashPassword(adminPassword);
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: "HR Admin",
          passwordHash,
          role: "HR_ADMIN",
          orgId: org.id,
        },
      });
      console.log(`HR_ADMIN user created: ${adminEmail} (org: ${org.slug})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
