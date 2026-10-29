import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { HIRING_STARTER_ROLES } from "../lib/hiring/roles";

/**
 * Hiring reference data — docs/blueprints/hiring.md AC1.5. Runs on every
 * production build (via prisma/seed.ts), so it is idempotent:
 *
 *  - the knowledge base (grades, competencies, JD templates, question bank)
 *    loads ONCE, guarded by the `seed.referenceVersion` marker — HR edits and
 *    deletes afterwards are never undone by a deploy;
 *  - each configuration default (approval chains, assessment policy, panel
 *    mode) is written only if that key has never been set.
 *
 * Budget envelopes are deliberately NOT seeded: Interview Hub's seed wrote
 * demo figures there, and a reference number HR did not enter is worse than
 * none. Starter content is Interview Hub's "oman-it-v1" knowledge base
 * (monthly OMR bands), plus a starter question bank of two questions per
 * competency; every row is editable in Hiring → Library.
 *
 * Uses the raw client (plain creates, find-then-create), like the foundation
 * seed.
 */

const REFERENCE_VERSION = "oman-it-v1";

const COMPETENCIES: {
  name: string;
  category: string;
  roleFamily: string;
  definition: string;
}[] = [
  // Technical
  {
    name: "Software Engineering & Code Quality",
    category: "technical",
    roleFamily: "Engineering",
    definition:
      "Writes clean, readable, well-tested code; applies sound design patterns; participates constructively in code review.",
  },
  {
    name: "System Design & Architecture",
    category: "technical",
    roleFamily: "Engineering",
    definition:
      "Designs scalable, maintainable systems; reasons explicitly about trade-offs, failure modes, and data flow.",
  },
  {
    name: "Cloud & DevOps",
    category: "technical",
    roleFamily: "Infrastructure",
    definition:
      "Builds and operates on cloud platforms (Azure/AWS/GCP); CI/CD, infrastructure-as-code, observability, and cost awareness.",
  },
  {
    name: "Data Engineering & Analytics",
    category: "technical",
    roleFamily: "Data",
    definition:
      "Models, pipelines, and analyses data; comfortable with SQL, warehousing, and turning data into decisions.",
  },
  {
    name: "Cybersecurity & Information Assurance",
    category: "technical",
    roleFamily: "Security",
    definition:
      "Applies secure-by-design principles, threat modelling, and controls aligned to ISO 27001 / national guidance.",
  },
  {
    name: "Quality Assurance & Testing",
    category: "technical",
    roleFamily: "Quality",
    definition:
      "Designs test strategies, automates regression, and protects release quality across the SDLC.",
  },
  {
    name: "IT Service Management (ITIL)",
    category: "technical",
    roleFamily: "Operations",
    definition:
      "Runs incident, problem, and change management to agreed SLAs; customer-focused service delivery.",
  },
  {
    name: "Solution Architecture",
    category: "technical",
    roleFamily: "Architecture",
    definition:
      "Translates business needs into coherent, integration-ready technical solutions and standards.",
  },
  // Domain / Oman-specific
  {
    name: "Bilingual Communication (Arabic & English)",
    category: "domain",
    roleFamily: "General",
    definition:
      "Produces clear written and spoken communication in both Arabic and English for mixed audiences.",
  },
  {
    name: "Regulatory & Compliance Awareness",
    category: "domain",
    roleFamily: "General",
    definition: "Understands Oman Labour Law, and sector regulation relevant to the role.",
  },
  {
    name: "Public-Sector & Enterprise Delivery",
    category: "domain",
    roleFamily: "Delivery",
    definition:
      "Navigates government/enterprise procurement, In-Country Value expectations, and stakeholder governance.",
  },
  // Behavioral
  {
    name: "Problem Solving",
    category: "behavioral",
    roleFamily: "General",
    definition:
      "Breaks down ambiguous problems, weighs options, and reaches sound, evidence-based decisions.",
  },
  {
    name: "Communication",
    category: "behavioral",
    roleFamily: "General",
    definition: "Conveys ideas clearly; listens actively and adapts the message to the audience.",
  },
  {
    name: "Collaboration & Teamwork",
    category: "behavioral",
    roleFamily: "General",
    definition:
      "Works effectively across teams; shares context, gives and receives feedback, supports peers.",
  },
  {
    name: "Ownership & Accountability",
    category: "behavioral",
    roleFamily: "General",
    definition: "Takes end-to-end responsibility for outcomes and follows through under pressure.",
  },
  {
    name: "Adaptability & Continuous Learning",
    category: "behavioral",
    roleFamily: "General",
    definition: "Adjusts to change, picks up new domains quickly, and invests in growing skills.",
  },
  {
    name: "Customer Focus",
    category: "behavioral",
    roleFamily: "General",
    definition:
      "Anticipates user and client needs; measures success by the value delivered to them.",
  },
  // Leadership
  {
    name: "Strategic Thinking",
    category: "leadership",
    roleFamily: "Leadership",
    definition: "Connects daily work to organisational goals and anticipates second-order effects.",
  },
  {
    name: "People Leadership & Coaching",
    category: "leadership",
    roleFamily: "Leadership",
    definition: "Develops, motivates, and gives timely feedback; builds capable, engaged teams.",
  },
  {
    name: "Stakeholder Management",
    category: "leadership",
    roleFamily: "Leadership",
    definition: "Aligns expectations and builds trust across internal and external stakeholders.",
  },
];

// ── Grade / salary bands (monthly OMR) ────────────────────────────────────
const GRADES: {
  code: string;
  name: string;
  minSalary: number;
  maxSalary: number;
  order: number;
}[] = [
  { code: "G1", name: "Graduate / Trainee", minSalary: 400, maxSalary: 650, order: 1 },
  { code: "G2", name: "Junior", minSalary: 650, maxSalary: 950, order: 2 },
  { code: "G3", name: "Associate", minSalary: 950, maxSalary: 1400, order: 3 },
  { code: "G4", name: "Senior", minSalary: 1400, maxSalary: 2100, order: 4 },
  { code: "G5", name: "Specialist / Lead", minSalary: 2100, maxSalary: 3000, order: 5 },
  { code: "G6", name: "Principal", minSalary: 3000, maxSalary: 4200, order: 6 },
  { code: "G7", name: "Manager", minSalary: 3500, maxSalary: 5200, order: 7 },
  { code: "G8", name: "Senior Manager / Director", minSalary: 5200, maxSalary: 7800, order: 8 },
  { code: "G9", name: "Head / VP", minSalary: 7800, maxSalary: 11500, order: 9 },
];

// ── JD templates (common Oman IT roles) ────────────────────────────────────
const JD_TEMPLATES: {
  title: string;
  roleFamily: string;
  grade: string;
  competencies: string[];
  description: string;
}[] = [
  {
    title: "Software Engineer",
    grade: "G3",
    roleFamily: "Engineering",
    competencies: [
      "Software Engineering & Code Quality",
      "System Design & Architecture",
      "Problem Solving",
      "Communication",
    ],
    description:
      "Design, build, and maintain reliable software across the stack. Responsibilities: write clean, tested code; contribute to design and code review; collaborate with product and QA. Requirements: solid CS fundamentals; experience with a modern stack; bilingual (Arabic/English) communication an advantage. Omani nationals are encouraged to apply (Omanization priority).",
  },
  {
    title: "Senior Software Engineer",
    grade: "G4",
    roleFamily: "Engineering",
    competencies: [
      "System Design & Architecture",
      "Software Engineering & Code Quality",
      "Ownership & Accountability",
      "Collaboration & Teamwork",
    ],
    description:
      "Own significant technical scope and raise the team's engineering bar. Responsibilities: lead design of non-trivial systems; mentor engineers; drive quality and delivery. Requirements: 5+ years building production systems; strong system-design and trade-off reasoning.",
  },
  {
    title: "DevOps / Cloud Engineer",
    grade: "G3",
    roleFamily: "Infrastructure",
    competencies: [
      "Cloud & DevOps",
      "Cybersecurity & Information Assurance",
      "Problem Solving",
      "Ownership & Accountability",
    ],
    description:
      "Build and operate cloud infrastructure and delivery pipelines. Responsibilities: CI/CD, infrastructure-as-code, observability, cost and reliability. Requirements: hands-on Azure/AWS; containers and IaC (Terraform); on-call maturity.",
  },
  {
    title: "Cybersecurity Analyst",
    grade: "G3",
    roleFamily: "Security",
    competencies: [
      "Cybersecurity & Information Assurance",
      "Regulatory & Compliance Awareness",
      "Problem Solving",
      "Communication",
    ],
    description:
      "Protect systems and data and support compliance. Responsibilities: monitoring, vulnerability management, incident response, control assessment aligned to ISO 27001 and national guidance. Requirements: security fundamentals; relevant certification (e.g. Security+, CEH) a plus.",
  },
  {
    title: "Data Analyst",
    grade: "G3",
    roleFamily: "Data",
    competencies: [
      "Data Engineering & Analytics",
      "Problem Solving",
      "Communication",
      "Customer Focus",
    ],
    description:
      "Turn data into decisions for business and product teams. Responsibilities: SQL analysis, dashboards, and clear narratives. Requirements: strong SQL; a BI tool (Power BI/Tableau); ability to communicate insight in Arabic and English.",
  },
  {
    title: "QA Engineer",
    grade: "G3",
    roleFamily: "Quality",
    competencies: [
      "Quality Assurance & Testing",
      "Software Engineering & Code Quality",
      "Ownership & Accountability",
      "Collaboration & Teamwork",
    ],
    description:
      "Protect release quality across the SDLC. Responsibilities: test strategy, automation, regression, and release sign-off. Requirements: test automation experience; an eye for edge cases and user impact.",
  },
  {
    title: "IT Service Desk Analyst",
    grade: "G2",
    roleFamily: "Operations",
    competencies: [
      "IT Service Management (ITIL)",
      "Customer Focus",
      "Communication",
      "Bilingual Communication (Arabic & English)",
    ],
    description:
      "First point of contact for IT support. Responsibilities: incident logging and resolution, request fulfilment, and escalation to agreed SLAs. Requirements: ITIL awareness; strong bilingual customer service.",
  },
  {
    title: "Product Manager",
    grade: "G5",
    roleFamily: "Product",
    competencies: [
      "Strategic Thinking",
      "Stakeholder Management",
      "Customer Focus",
      "Communication",
    ],
    description:
      "Own the roadmap for a product area. Responsibilities: discovery, prioritisation, and delivery; align stakeholders; define and track success metrics. Requirements: strong product sense; data-informed decision making; excellent bilingual communication.",
  },
  {
    title: "Project Manager",
    grade: "G5",
    roleFamily: "Delivery",
    competencies: [
      "Public-Sector & Enterprise Delivery",
      "Stakeholder Management",
      "Communication",
      "Ownership & Accountability",
    ],
    description:
      "Deliver IT projects on time, scope, and budget. Responsibilities: planning, governance, risk, and stakeholder reporting for enterprise/government clients. Requirements: PMP/PRINCE2 an advantage; experience with In-Country Value and government governance.",
  },
  {
    title: "Business Analyst",
    grade: "G3",
    roleFamily: "Delivery",
    competencies: [
      "Public-Sector & Enterprise Delivery",
      "Communication",
      "Problem Solving",
      "Bilingual Communication (Arabic & English)",
    ],
    description:
      "Bridge business needs and technical delivery. Responsibilities: requirements elicitation, process mapping, and bilingual documentation. Requirements: structured analysis; clear Arabic/English writing.",
  },
  {
    title: "Solution Architect",
    grade: "G6",
    roleFamily: "Architecture",
    competencies: [
      "Solution Architecture",
      "System Design & Architecture",
      "Stakeholder Management",
      "Strategic Thinking",
    ],
    description:
      "Define coherent, integration-ready solutions and standards. Responsibilities: solution design, technical governance, and vendor/stack decisions. Requirements: broad architecture experience; strong communication with technical and business audiences.",
  },
  {
    title: "Engineering Manager",
    grade: "G7",
    roleFamily: "Leadership",
    competencies: [
      "People Leadership & Coaching",
      "Strategic Thinking",
      "Stakeholder Management",
      "Ownership & Accountability",
    ],
    description:
      "Lead an engineering team's delivery, performance, and growth. Responsibilities: people management, delivery, and technical strategy; champion Omanization and capability building. Requirements: prior engineering + leadership experience; coaching mindset.",
  },
];

const QUESTIONS: {
  competency: string;
  roleFamily: string;
  category: string;
  questionText: string;
}[] = [
  {
    competency: "Software Engineering & Code Quality",
    roleFamily: "Engineering",
    category: "competency",
    questionText:
      "Walk me through how you review a colleague's pull request. What do you look for first, and why?",
  },
  {
    competency: "Software Engineering & Code Quality",
    roleFamily: "Engineering",
    category: "behavioral",
    questionText:
      "Tell me about a time you inherited poorly tested code. What did you change, and what did you leave alone?",
  },
  {
    competency: "System Design & Architecture",
    roleFamily: "Engineering",
    category: "role-specific",
    questionText:
      "Design a service that accepts job applications from a public careers page. Where would it break first under load?",
  },
  {
    competency: "System Design & Architecture",
    roleFamily: "Engineering",
    category: "behavioral",
    questionText:
      "Describe a design decision you made that you would reverse today. What changed your mind?",
  },
  {
    competency: "Cloud & DevOps",
    roleFamily: "Infrastructure",
    category: "role-specific",
    questionText:
      "A deployment succeeded but error rates doubled. Walk me through the first fifteen minutes.",
  },
  {
    competency: "Cloud & DevOps",
    roleFamily: "Infrastructure",
    category: "competency",
    questionText: "How do you keep cloud costs visible to the team that creates them?",
  },
  {
    competency: "Data Engineering & Analytics",
    roleFamily: "Data",
    category: "role-specific",
    questionText: "When does a composite index help a query, and when does it not?",
  },
  {
    competency: "Data Engineering & Analytics",
    roleFamily: "Data",
    category: "behavioral",
    questionText:
      "Tell me about an analysis whose result surprised the people who asked for it. How did you present it?",
  },
  {
    competency: "Cybersecurity & Information Assurance",
    roleFamily: "Security",
    category: "role-specific",
    questionText: "How would you threat-model a page that accepts CV uploads from the public?",
  },
  {
    competency: "Cybersecurity & Information Assurance",
    roleFamily: "Security",
    category: "behavioral",
    questionText:
      "Describe a security finding you had to escalate against resistance. How did it end?",
  },
  {
    competency: "Quality Assurance & Testing",
    roleFamily: "Quality",
    category: "competency",
    questionText: "How do you decide what not to automate?",
  },
  {
    competency: "Quality Assurance & Testing",
    roleFamily: "Quality",
    category: "behavioral",
    questionText:
      "Tell me about a defect that reached production despite your testing. What did you change afterwards?",
  },
  {
    competency: "IT Service Management (ITIL)",
    roleFamily: "Operations",
    category: "role-specific",
    questionText:
      "How do you tell an incident from a problem, and why does the difference matter to the customer?",
  },
  {
    competency: "IT Service Management (ITIL)",
    roleFamily: "Operations",
    category: "behavioral",
    questionText: "Describe a time you had to tell a customer their SLA would be missed.",
  },
  {
    competency: "Solution Architecture",
    roleFamily: "Architecture",
    category: "role-specific",
    questionText:
      "A client wants to integrate with three legacy systems in six weeks. How do you scope it?",
  },
  {
    competency: "Solution Architecture",
    roleFamily: "Architecture",
    category: "competency",
    questionText:
      "How do you document an architecture decision so that someone can challenge it a year later?",
  },
  {
    competency: "Bilingual Communication (Arabic & English)",
    roleFamily: "General",
    category: "competency",
    questionText:
      "Explain a technical change you made to a non-technical stakeholder — first in English, then summarise it in Arabic.",
  },
  {
    competency: "Bilingual Communication (Arabic & English)",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Tell me about a misunderstanding caused by language or translation. How did you resolve it?",
  },
  {
    competency: "Regulatory & Compliance Awareness",
    roleFamily: "General",
    category: "competency",
    questionText:
      "Which regulation most affected your last role's day-to-day work, and how did it show up in your decisions?",
  },
  {
    competency: "Regulatory & Compliance Awareness",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Describe a time a compliance requirement slowed a project. How did you handle the trade-off?",
  },
  {
    competency: "Public-Sector & Enterprise Delivery",
    roleFamily: "Delivery",
    category: "role-specific",
    questionText:
      "How do In-Country Value expectations change the way you plan a government project?",
  },
  {
    competency: "Public-Sector & Enterprise Delivery",
    roleFamily: "Delivery",
    category: "behavioral",
    questionText:
      "Tell me about a procurement or governance step that put a delivery at risk. What did you do?",
  },
  {
    competency: "Problem Solving",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Walk me through the hardest production incident you have debugged. How did you narrow it down?",
  },
  {
    competency: "Problem Solving",
    roleFamily: "General",
    category: "competency",
    questionText: "You have two plausible root causes and time to test one. How do you choose?",
  },
  {
    competency: "Communication",
    roleFamily: "General",
    category: "behavioral",
    questionText: "Tell me about a time your message was misunderstood. What did you change?",
  },
  {
    competency: "Communication",
    roleFamily: "General",
    category: "competency",
    questionText:
      "How do you write an update for a senior stakeholder who will read only the first two lines?",
  },
  {
    competency: "Collaboration & Teamwork",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Describe a disagreement with a peer about how to do the work. How was it settled?",
  },
  {
    competency: "Collaboration & Teamwork",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Tell me about a time you helped a teammate succeed at the expense of your own task.",
  },
  {
    competency: "Ownership & Accountability",
    roleFamily: "General",
    category: "behavioral",
    questionText: "Tell me about a commitment you missed. When did you raise it, and with whom?",
  },
  {
    competency: "Ownership & Accountability",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Describe something you fixed that was not your responsibility. Why did you take it on?",
  },
  {
    competency: "Adaptability & Continuous Learning",
    roleFamily: "General",
    category: "behavioral",
    questionText: "What is the last skill you learned for a job, and how did you learn it?",
  },
  {
    competency: "Adaptability & Continuous Learning",
    roleFamily: "General",
    category: "behavioral",
    questionText: "Tell me about a change in direction you disagreed with but had to deliver.",
  },
  {
    competency: "Customer Focus",
    roleFamily: "General",
    category: "behavioral",
    questionText:
      "Describe a time you pushed back on what a customer asked for because it was not what they needed.",
  },
  {
    competency: "Customer Focus",
    roleFamily: "General",
    category: "competency",
    questionText:
      "How do you find out whether a customer is actually satisfied, rather than just not complaining?",
  },
  {
    competency: "Strategic Thinking",
    roleFamily: "Leadership",
    category: "competency",
    questionText:
      "Which of your team's activities would you stop if the budget fell by a third, and why?",
  },
  {
    competency: "Strategic Thinking",
    roleFamily: "Leadership",
    category: "behavioral",
    questionText:
      "Tell me about a decision you made whose second-order effects you anticipated — or missed.",
  },
  {
    competency: "People Leadership & Coaching",
    roleFamily: "Leadership",
    category: "behavioral",
    questionText:
      "Tell me about someone you developed who is now more senior than when you met them.",
  },
  {
    competency: "People Leadership & Coaching",
    roleFamily: "Leadership",
    category: "behavioral",
    questionText:
      "Describe a difficult performance conversation. How did you prepare, and what happened next?",
  },
  {
    competency: "Stakeholder Management",
    roleFamily: "Leadership",
    category: "behavioral",
    questionText:
      "Describe a time you managed a difficult stakeholder. What did they need that they were not asking for?",
  },
  {
    competency: "Stakeholder Management",
    roleFamily: "Leadership",
    category: "competency",
    questionText:
      "How do you keep two stakeholders with conflicting priorities informed without taking sides prematurely?",
  },
];

const DEFAULTS: Record<string, Prisma.InputJsonValue> = {
  "approvals.config": {
    chains: {
      RIHAL: ["HR_MANAGER", "OPERATIONS_DIRECTOR"],
      TP: ["HR_MANAGER", "OPERATIONS_DIRECTOR"],
      CL: ["HR_MANAGER", "OPERATIONS_DIRECTOR"],
    },
    cooThreshold: 2500,
  },
  "assessment.config": {
    name: "Cognitive aptitude — abstract, numerical, verbal",
    resultsUse: "ADVISORY",
    passThreshold: 60,
    validityMonths: 12,
  },
  "panel.aiMode": "blind",
};

async function setOnce(prisma: PrismaClient, key: string, value: Prisma.InputJsonValue) {
  // The core settings store (ADR-092), module "hiring".
  const where = { module_key: { module: "hiring", key } };
  const found = await prisma.moduleSetting.findUnique({ where, select: { id: true } });
  if (!found)
    await prisma.moduleSetting.create({
      data: { module: "hiring", key, value },
      select: { id: true },
    });
}

/** Created only if no role carries the key and no live role has the name. */
async function seedStarterRoles(prisma: PrismaClient): Promise<void> {
  for (const role of HIRING_STARTER_ROLES) {
    const found = await prisma.accessRole.findUnique({
      where: { starterKey: role.key },
      select: { id: true },
    });
    if (found) continue;
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

export async function seedHiring(prisma: PrismaClient): Promise<void> {
  await seedStarterRoles(prisma);
  for (const [key, value] of Object.entries(DEFAULTS)) await setOnce(prisma, key, value);

  const marker = await prisma.moduleSetting.findUnique({
    where: { module_key: { module: "hiring", key: "seed.referenceVersion" } },
    select: { value: true },
  });
  if (marker?.value === REFERENCE_VERSION) return;

  for (const g of GRADES) {
    await prisma.grade.create({ data: g, select: { id: true } });
  }
  for (const c of COMPETENCIES) {
    await prisma.competency.create({ data: c, select: { id: true } });
  }
  for (const j of JD_TEMPLATES) {
    await prisma.hiringJdTemplate.create({ data: j, select: { id: true } });
  }
  for (const q of QUESTIONS) {
    await prisma.hiringQuestion.create({ data: q, select: { id: true } });
  }
  await setOnce(prisma, "seed.referenceVersion", REFERENCE_VERSION);
  console.log(
    `Hiring reference data ${REFERENCE_VERSION}: ${GRADES.length} grades, ` +
      `${COMPETENCIES.length} competencies, ${JD_TEMPLATES.length} JD templates, ` +
      `${QUESTIONS.length} questions.`,
  );
}
