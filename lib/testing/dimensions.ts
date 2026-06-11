// Vibe Inspector — dimension catalog (ADR-016).
// Single source of truth for the testing dimensions: their display labels and the
// analysis brief each one hands to Claude. Keep in lockstep with the TestDimension
// enum in prisma/schema.prisma.

import type { TestDimension } from "@/generated/prisma/client";

export const DIMENSION_ORDER: TestDimension[] = [
  "DESIGN",
  "ACCESSIBILITY",
  "PERFORMANCE",
  "FUNCTIONALITY",
  "BRD_COVERAGE",
  "SECURITY",
  "BENCHMARK",
];

interface DimensionMeta {
  label: string;
  short: string;
  /** The focus brief injected into the per-dimension analysis prompt. */
  brief: string;
  /** Advisory dimensions are labelled as judgment calls in the report. */
  advisory: boolean;
}

export const DIMENSION_META: Record<TestDimension, DimensionMeta> = {
  DESIGN: {
    label: "Design fidelity",
    short: "Design",
    brief:
      "Visual and UX quality across the desktop AND mobile screenshots: layout, hierarchy, " +
      "spacing, typography, colour, responsiveness (does the mobile view hold up?), and " +
      "design polish. Judge against the BRD's intent and general design heuristics.",
    advisory: false,
  },
  ACCESSIBILITY: {
    label: "Accessibility (a11y)",
    short: "A11y",
    brief:
      "WCAG accessibility, grounded in the axe-core scan results provided (violations by " +
      "impact: critical/serious/moderate/minor). Summarise the most important violations, who " +
      "they affect, and how to fix them. Score from the count + severity of real violations; " +
      "do not invent issues beyond axe + what's visible.",
    advisory: false,
  },
  PERFORMANCE: {
    label: "Performance",
    short: "Perf",
    brief:
      "Front-end performance from the captured metrics: load time, DOMContentLoaded, number of " +
      "requests, and total transfer size. Flag slow loads, heavy pages, and excessive requests; " +
      "suggest concrete wins. Score against common web-performance norms (fast < 2.5s LCP-ish).",
    advisory: false,
  },
  FUNCTIONALITY: {
    label: "Functionality & logic",
    short: "Function",
    brief:
      "Whether the page works: dead/likely-broken links, console or runtime errors, " +
      "dead buttons, missing primary actions, and whether observed behaviour matches " +
      "what the BRD specifies. Use the console errors, link list, and control counts.",
    advisory: false,
  },
  BRD_COVERAGE: {
    label: "BRD coverage (QA)",
    short: "BRD",
    brief:
      "Requirement-by-requirement traceability: extract discrete requirements from the " +
      "BRD/scope, then judge each as MET, PARTIAL, or MISSING based on the captured page.",
    advisory: false,
  },
  SECURITY: {
    label: "Security (lightweight)",
    short: "Security",
    brief:
      "A lightweight surface check — NOT a penetration test. Assess TLS usage, security " +
      "response headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy), " +
      "mixed content, and any obviously exposed sensitive info. Flag gaps; do not claim a clean " +
      "bill of health.",
    advisory: true,
  },
  BENCHMARK: {
    label: "Benchmark vs peers",
    short: "Benchmark",
    brief:
      "Compare the site against 2–4 well-known peer products in its apparent domain. " +
      "Note where it meets, exceeds, or trails enterprise norms. This is advisory and based " +
      "on general knowledge of those peers, not a live comparison.",
    advisory: true,
  },
};

export function dimensionLabel(d: TestDimension): string {
  return DIMENSION_META[d]?.label ?? d;
}
