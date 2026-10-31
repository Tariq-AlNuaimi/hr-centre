import type { PrismaClient } from "../generated/prisma/client";
import { TICKET_STARTER_ROLES } from "../lib/hive/roles";
import { levelOf } from "../lib/core/hr-coverage/rules";
// The answer email's default wording has ONE owner (lib/validations/hive/email-template.ts).

/**
 * HR tickets (HIVE port) — the real configuration a fresh database starts from.
 * Ported from HIVE's `prisma/seed-hive.ts` (its figures, names, phone numbers and
 * dates come from the HIVE build specification, verified with Rihal HR — so
 * nothing here is paraphrased).
 *
 * What it seeds, and nothing more:
 *  - the four ticket starter roles (lib/hive/roles.ts) — no assignments: the
 *    HR logins do not exist yet, and a platform admin gives the roles;
 *  - the three HR Tag pairs, their members and coverage (labels + aliases);
 *    a member is linked to an HR Centre login with the same email if one exists
 *    (never creating a user);
 *  - the office rotation (config singleton, groups, coverage);
 *  - the employee discounts;
 *  - the answer-email template and the ticket settings defaults;
 *  - the org-chart display order for core units that exist by name (leaders are
 *    core unit heads now, set by HR in Organisation structure).
 *
 * NOT seeded: HIVE's 12 placeholder network providers (the real list arrives via
 * `npm run hive:providers -- <file.xlsx>`), HR accounts or role assignments,
 * tickets, and HIVE's retired chat/content tables (ADR-075 step 2).
 *
 * Idempotent (runs on every production build): every insert is find-then-create
 * on a natural key and it never overwrites — HR's later edits live in the DB.
 * Raw client (no audit/soft-delete extension), so the lookups filter
 * `deletedAt` themselves where a deleted row must count as "HR removed it".
 */

type Db = PrismaClient;

const HR_PAIRS = [
  {
    key: "shahed-afra",
    name: "Shahed Al Amri & Afra Al Hooti",
    order: 1,
    isDefault: false,
    members: [
      { name: "Shahed Al Amri", email: "Shahed.Amri@rihal.om", phone: "+968 9178 8564" },
      { name: "Afra Al Hooti", email: "Afra.Hooti@rihal.om", phone: "+968 7194 3347" },
    ],
    // Coverage owns its OWN labels (§4.4 note). These are not derived from the
    // org chart and renaming a directorate must not change them.
    coverage: [
      {
        label: "Data Engineering & Analytics Directorate",
        unit: "Data Engineering & Analytics",
        aliases: ["DEA", "Data Engineering", "Data Analytics", "Data Science", "Data Management"],
      },
      {
        label: "Operations Directorate (Rihal)",
        unit: "Operations",
        aliases: [
          "OPS",
          "Operations",
          "HR",
          "Human Resources",
          "Finance",
          "Legal",
          "PMO",
          "IT & Administration",
        ],
      },
      { label: "Codeline", aliases: ["Code Line", "CL"], company: "CL" },
    ],
  },
  {
    key: "rahma-mohammed",
    name: "Rahma Adam & Mohammed Al Amri",
    order: 2,
    isDefault: false,
    members: [
      { name: "Rahma Adam", email: "Rahma.Adam@rihal.om", phone: "+968 9249 5377" },
      { name: "Mohammed Al Amri", email: "Mohammed.Amri@rihal.om", phone: "+968 9960 4722" },
    ],
    coverage: [
      {
        label: "Technology & Development Directorate",
        unit: "Technology & Development",
        // §4.1: an employee saying "I'm in Software Engineering" must resolve
        // the same as "Tech" or "DevOps" or "QA".
        aliases: [
          "TECH",
          "Tech",
          "Technology",
          "Software",
          "Software Engineering",
          "SE",
          "DevOps",
          "ML",
          "Machine Learning",
          "RPA",
          "UI/UX",
          "UX",
          "QA",
          "Quality Assurance",
          "Security",
          "Security Engineering",
        ],
      },
    ],
  },
  {
    key: "siham-alaa",
    name: "Siham Al Hadhrami & Alaa Al Hinai",
    order: 3,
    // §6.6's flow routes TP directly to this pair, and it is the widest
    // coverage, so it is the fallback when a department cannot be resolved.
    isDefault: true,
    members: [
      { name: "Siham Al Hadhrami", email: "Siham.Hadhrami@rihal.om", phone: "+968 9352 8698" },
      { name: "Alaa Al Hinai", email: "Alaa.Hinai@rihal.om", phone: "+968 9671 5300" },
    ],
    coverage: [
      {
        label: "Commercials Directorate (Rihal)",
        unit: "Commercials",
        aliases: ["COM", "Commercials", "Sales", "Pre-Sales", "Marketing"],
      },
      { label: "Strategy Directorate (Rihal)", aliases: ["STR", "Strategy"], unit: "Strategy" },
      {
        label: "Products Directorate (Rihal)",
        unit: "Products",
        aliases: ["PD", "Products", "Product Management", "New Ventures"],
      },
      {
        label: "Transformation Pioneers (all)",
        aliases: ["TP", "Transformation Pioneers"],
        company: "TP",
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Org-chart details (HIVE §6.5) — display order for the `hive_org_structure`
// tool. HR Centre's core org is the JML module's; these rows only DESCRIBE core
// units, matched by name inside their company, once those units exist.
// ---------------------------------------------------------------------------

const RIHAL_DIRECTORATES = [
  {
    name: "Operations",
    teams: [
      "Human Resources",
      "Accounting & Finance",
      "IT & Administration",
      "Support & Managed Services",
      "Legal",
      "PMO",
    ],
  },
  {
    name: "Commercials",
    teams: ["Sales", "Pre-Sales", "Marketing"],
  },
  {
    name: "Products",
    teams: ["Product Management", "New Ventures"],
  },
  {
    name: "Data Engineering & Analytics",
    teams: ["Data Engineering", "Data Analytics", "Data Science", "Data Management"],
  },
  {
    name: "Technology & Development",
    teams: [
      "UI/UX Design",
      "Quality Assurance",
      "Machine Learning",
      "RPA (Robotic Process Automation)",
      "Security Engineering",
      "Software",
    ],
  },
  { name: "Strategy", teams: [] },
];

const TP_DEPARTMENTS = [
  {
    name: "Commercials",
    teams: ["Marketing", "Sales", "Account Management"],
  },
  {
    name: "Operations",
    teams: ["HR", "Finance", "Admin", "IT", "Legal"],
  },
  // §6.5: these four are their own entities, peers to Commercials and
  // Operations — NOT nested inside Operations, even though their managers
  // report to the Operation Manager.
  {
    name: "Project & Change Management",
    teams: [],
  },
  {
    name: "Digital Transformation & AI",
    teams: [],
  },
  {
    name: "Digital Trust & Resilience",
    teams: [],
  },
  {
    name: "ERP & Digital Innovation",
    teams: [],
  },
];

// ---------------------------------------------------------------------------
// Office rotation (HIVE §4.4). Labels and aliases are owned HERE, independent of
// the org chart and of HR Tag routing.
// ---------------------------------------------------------------------------

const ROTATION_GROUPS = [
  {
    name: "Operations (constant)",
    mode: "CONSTANT" as const,
    order: 0,
    coverage: [{ label: "Operations", aliases: ["OPS", "Ops", "Operations Directorate"] }],
  },
  {
    name: "Group 1",
    mode: "GROUP_1" as const,
    order: 1,
    coverage: [
      { label: "Commercials", aliases: ["COM", "Sales", "Pre-Sales", "Marketing"] },
      { label: "Strategy", aliases: ["STR"] },
      { label: "Products", aliases: ["PD", "Product Management", "New Ventures"] },
      {
        label: "Data Engineering & Analytics",
        aliases: ["DEA", "Data Engineering", "Data Analytics", "Data Science", "Data Management"],
      },
      { label: "Transformation Pioneers", aliases: ["TP"] },
    ],
  },
  {
    name: "Group 2",
    mode: "GROUP_2" as const,
    order: 2,
    coverage: [
      {
        label: "Technology & Development",
        // §4.4 spells out exactly what TECH covers; §4.1 requires the informal
        // and job-title forms to resolve to it too.
        aliases: [
          "TECH",
          "Tech",
          "Software",
          "Software Engineering",
          "SE",
          "DevOps",
          "ML",
          "Machine Learning",
          "RPA",
          "Robotic Process Automation",
          "UI/UX",
          "UX",
          "QA",
          "Quality Assurance",
          "Security",
          "Security Engineering",
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Employee discounts (HIVE §6.4). Alhut Alealamia's expiry is "Not specified":
// NULL, never treated as expired.
// ---------------------------------------------------------------------------

const DISCOUNTS = [
  {
    name: "Alhut Alealamia Car Wash",
    offerSummary: "Discounted wash rates (e.g. Full Wash: 2 OMR Saloon / 4 OMR Four-Wheel)",
    eligibility: "ALL" as const,
    validUntil: null,
    onlineOnly: false,
    url: null,
  },
  {
    name: "Coat Fitters",
    offerSummary: "20% off mobile phone accessories",
    eligibility: "ALL" as const,
    validUntil: "2026-09-30",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Madhher",
    offerSummary: "10% off all items",
    eligibility: "ALL" as const,
    validUntil: "2026-09-30",
    onlineOnly: false,
    url: null,
  },
  {
    name: "So Elegant Salon",
    offerSummary: "20% off services (men's & women's sections), 10% off occasion/home services",
    eligibility: "ALL" as const,
    validUntil: "2026-09-30",
    onlineOnly: false,
    url: null,
  },
  {
    name: "The Myriad",
    offerSummary: "Discounted hostel rooms; resident gym & spa discounts",
    eligibility: "FEMALE_PLUS_FAMILY" as const,
    validUntil: "2026-10-11",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Backstage Salon",
    offerSummary: "20% off services above 10 OMR",
    eligibility: "FEMALE_ONLY" as const,
    validUntil: "2027-02-28",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Minimo Cafe",
    offerSummary: "15% off drinks, 10% off coffee beans",
    eligibility: "ALL" as const,
    validUntil: "2027-05-20",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Centara Muscat Hotel",
    offerSummary: "Discounted rooms; 20% off F&B; free gym & pool access",
    eligibility: "ALL" as const,
    validUntil: "2027-05-11",
    onlineOnly: false,
    url: null,
  },
  {
    name: "Life Line Fitness",
    offerSummary: "Discounted membership plans",
    eligibility: "ALL" as const,
    validUntil: "2027-06-02",
    onlineOnly: false,
    url: null,
  },
  // §6.4: Silaf is the exception to "present the company ID card" — online
  // only, registered with work email, discount auto-applied at checkout.
  {
    name: "Silaf",
    offerSummary: "10% off coffee items (online only, silaf.co)",
    eligibility: "ALL" as const,
    validUntil: "2027-06-27",
    onlineOnly: true,
    url: "https://silaf.co",
  },
];

/** HIVE company order (tool option order): Rihal, Transformation Pioneers, Codeline. */
const COMPANY_ORDER: Record<string, number> = { RIHAL: 1, TP: 2, CL: 3 };

/** Rotation coverage rows that belong to a company other than Rihal. */
const ROTATION_COMPANY: Record<string, string> = { "Transformation Pioneers": "TP" };

export async function seedHive(prisma: Db): Promise<void> {
  const entities = new Map<string, string>();
  for (const e of await prisma.orgEntity.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true },
    take: 50,
  })) {
    entities.set(e.code, e.id);
  }

  await seedStarterRoles(prisma);
  await seedPairs(prisma, entities);
  await seedMemberLinks(prisma);
  await seedRotation(prisma, entities);
  await seedDiscounts(prisma);
  // The answer template and ticket settings need no seed: with nothing stored, the
  // defaults in code apply (core stores, ADR-092 / ADR-095).
  await seedOrgInfo(prisma, entities);
}

async function seedStarterRoles(prisma: Db): Promise<void> {
  for (const role of TICKET_STARTER_ROLES) {
    const found = await prisma.accessRole.findUnique({
      where: { starterKey: role.key },
      select: { id: true },
    });
    if (found) continue;
    // A same-named role an admin made by hand is theirs: do not add a twin.
    const clash = await prisma.accessRole.findFirst({
      where: { name: { equals: role.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (clash) continue;
    await prisma.accessRole.create({
      data: {
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        starterKey: role.key,
      },
      select: { id: true },
    });
  }
}

/** A core unit's id by name inside a company (directorate, else top-level department). */
async function unitIn(prisma: Db, entityId: string | undefined, name: string) {
  if (!entityId) return { directorateId: null, departmentId: null };
  const directorate = await prisma.directorate.findFirst({
    where: { entityId, name, deletedAt: null },
    select: { id: true },
  });
  if (directorate) return { directorateId: directorate.id, departmentId: null };
  const department = await prisma.department.findFirst({
    where: { entityId, name, deletedAt: null },
    select: { id: true },
  });
  return { directorateId: null, departmentId: department?.id ?? null };
}

async function seedPairs(prisma: Db, entities: Map<string, string>): Promise<void> {
  const rihal = entities.get("RIHAL");
  for (const p of HR_PAIRS) {
    let pair = await prisma.hrTagPair.findFirst({ where: { name: p.name } });
    // A pair HR deleted stays deleted.
    if (pair?.deletedAt) continue;
    pair ??= await prisma.hrTagPair.create({
      data: { name: p.name, order: p.order, isDefault: p.isDefault },
    });
    for (const [i, m] of p.members.entries()) {
      const found = await prisma.hrTagMember.findFirst({
        where: { pairId: pair.id, email: { equals: m.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (!found) {
        await prisma.hrTagMember.create({
          data: { pairId: pair.id, name: m.name, email: m.email, phone: m.phone, order: i + 1 },
        });
      }
    }
    for (const cov of p.coverage) {
      const companyCode = "company" in cov ? (cov.company as string) : null;
      // Company-wide rows name their company; every directorate row here is a
      // Rihal directorate (HIVE linked them to Rihal units only), so it is
      // SCOPED to Rihal — "Operations" at TP must never reach Rihal's pair.
      const entityId = companyCode ? (entities.get(companyCode) ?? null) : (rihal ?? null);
      const unitName = "unit" in cov ? (cov.unit as string) : null;
      const unit = unitName ? await unitIn(prisma, rihal, unitName) : null;
      const found = await prisma.hrCoverage.findFirst({
        where: { pairId: pair.id, label: cov.label },
      });
      if (found) {
        // Fill a soft link that appeared since (HR loaded the org), never overwrite.
        if (
          unit &&
          !found.directorateId &&
          !found.departmentId &&
          (unit.directorateId || unit.departmentId)
        ) {
          await prisma.hrCoverage.update({
            where: { id: found.id },
            data: { ...unit, level: levelOf({ ...found, ...unit }) },
          });
        }
        continue;
      }
      if (companyCode && !entityId) continue; // that company is not in this database
      await prisma.hrCoverage.create({
        data: {
          pairId: pair.id,
          label: cov.label,
          aliases: [...cov.aliases],
          entityId,
          companyWide: companyCode !== null,
          directorateId: unit?.directorateId ?? null,
          departmentId: unit?.departmentId ?? null,
          level: levelOf({
            companyWide: companyCode !== null,
            entityId,
            directorateId: unit?.directorateId ?? null,
            departmentId: unit?.departmentId ?? null,
          }),
        },
      });
    }
  }
}

/** Link each HR Tag member to the HR Centre login with the same email, once. */
async function seedMemberLinks(prisma: Db): Promise<void> {
  const members = await prisma.hrTagMember.findMany({
    where: { userId: null, deletedAt: null },
    select: { id: true, email: true },
    take: 200,
  });
  for (const m of members) {
    const user = await prisma.user.findUnique({
      where: { email: m.email.trim().toLowerCase() },
      select: { id: true, deletedAt: true, hiveTagMember: { select: { id: true } } },
    });
    if (!user || user.deletedAt || user.hiveTagMember) continue;
    await prisma.hrTagMember.update({ where: { id: m.id }, data: { userId: user.id } });
  }
}

async function seedRotation(prisma: Db, entities: Map<string, string>): Promise<void> {
  // The anchor: Sunday 29 March 2026 is a Type A week (asserted by the tests).
  const config = await prisma.rotationConfig.findUnique({ where: { id: "singleton" } });
  if (!config) {
    await prisma.rotationConfig.create({
      data: {
        id: "singleton",
        anchorDate: new Date("2026-03-29T00:00:00.000Z"),
        anchorType: "A",
        timezone: "Asia/Muscat",
        weekendDays: [5, 6], // ISO: Friday=5, Saturday=6
      },
    });
  }
  const rihal = entities.get("RIHAL");
  for (const g of ROTATION_GROUPS) {
    let group = await prisma.rotationGroup.findFirst({ where: { name: g.name } });
    if (group?.deletedAt) continue;
    group ??= await prisma.rotationGroup.create({
      data: { name: g.name, mode: g.mode, order: g.order },
    });
    for (const cov of g.coverage) {
      const code = ROTATION_COMPANY[cov.label] ?? "RIHAL";
      const entityId = entities.get(code) ?? null;
      const unit = code === "RIHAL" ? await unitIn(prisma, rihal, cov.label) : null;
      const found = await prisma.rotationCoverage.findFirst({
        where: { groupId: group.id, label: cov.label },
      });
      if (found) {
        if (
          unit &&
          !found.directorateId &&
          !found.departmentId &&
          (unit.directorateId || unit.departmentId)
        ) {
          await prisma.rotationCoverage.update({ where: { id: found.id }, data: unit });
        }
        continue;
      }
      await prisma.rotationCoverage.create({
        data: {
          groupId: group.id,
          label: cov.label,
          aliases: [...cov.aliases],
          entityId,
          directorateId: unit?.directorateId ?? null,
          departmentId: unit?.departmentId ?? null,
        },
      });
    }
  }
}

async function seedDiscounts(prisma: Db): Promise<void> {
  for (const [i, d] of DISCOUNTS.entries()) {
    const found = await prisma.discountPartner.findFirst({ where: { name: d.name } });
    if (found) continue;
    await prisma.discountPartner.create({
      data: {
        name: d.name,
        offerSummary: d.offerSummary,
        eligibility: d.eligibility,
        validUntil: d.validUntil ? new Date(`${d.validUntil}T00:00:00.000Z`) : null,
        onlineOnly: d.onlineOnly,
        url: d.url,
        order: i + 1,
        redemption: d.onlineOnly
          ? "Online only — register with your work email and the discount is applied at checkout."
          : "Present your company ID card at the time of service.",
      },
    });
  }
}

async function ensureInfo(
  prisma: Db,
  kind: "COMPANY" | "DIRECTORATE" | "DEPARTMENT" | "TEAM",
  unitId: string,
  data: { order: number },
): Promise<void> {
  const found = await prisma.hiveOrgUnitInfo.findUnique({
    where: { kind_unitId: { kind, unitId } },
    select: { id: true },
  });
  if (found) return;
  await prisma.hiveOrgUnitInfo.create({
    data: {
      kind,
      unitId,
      order: data.order,
    },
  });
}

async function seedOrgInfo(prisma: Db, entities: Map<string, string>): Promise<void> {
  for (const [code, order] of Object.entries(COMPANY_ORDER)) {
    const id = entities.get(code);
    if (id) await ensureInfo(prisma, "COMPANY", id, { order });
  }
  const sections: Array<[string, typeof RIHAL_DIRECTORATES | typeof TP_DEPARTMENTS]> = [
    ["RIHAL", RIHAL_DIRECTORATES],
    ["TP", TP_DEPARTMENTS],
  ];
  for (const [code, units] of sections) {
    const entityId = entities.get(code);
    if (!entityId) continue;
    for (const [i, u] of units.entries()) {
      const { directorateId, departmentId } = await unitIn(prisma, entityId, u.name);
      const top = directorateId
        ? { kind: "DIRECTORATE" as const, id: directorateId }
        : departmentId
          ? { kind: "DEPARTMENT" as const, id: departmentId }
          : null;
      if (!top) continue; // HR has not created this unit yet; the next deploy links it
      await ensureInfo(prisma, top.kind, top.id, { order: i + 1 });
      // Child order, as HIVE listed it (Rihal: departments; TP: teams).
      for (const [j, child] of u.teams.entries()) {
        const childRow =
          top.kind === "DIRECTORATE"
            ? await prisma.department.findFirst({
                where: { directorateId: top.id, name: child, deletedAt: null },
                select: { id: true },
              })
            : await prisma.team.findFirst({
                where: { departmentId: top.id, name: child, deletedAt: null },
                select: { id: true },
              });
        if (childRow) {
          await ensureInfo(
            prisma,
            top.kind === "DIRECTORATE" ? "DEPARTMENT" : "TEAM",
            childRow.id,
            {
              order: j + 1,
            },
          );
        }
      }
    }
  }
}
