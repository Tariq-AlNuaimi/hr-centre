import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { seedDemoCycle } from "./seed-demo-cycle";

/**
 * `npm run db:demo-cycle` — build a complete performance year on top of the
 * demo org fixture. Deliberately NOT part of `prisma db seed`: the org seed runs
 * on every deploy, and this one writes appraisal ratings, which is a thing
 * someone should have to ask for. Its own guards refuse to run against a
 * database holding real people — see `seed-demo-cycle.ts`.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

try {
  await seedDemoCycle(prisma);
} finally {
  await prisma.$disconnect();
}
