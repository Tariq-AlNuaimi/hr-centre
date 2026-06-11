// Vibe Inspector — methodology rubrics (ADR-016).
//
// These distill the template's OWN QA + security methodology so the AI grades a
// target site against a real, documented standard rather than ad-hoc opinion. They
// are adapted for BLACK-BOX external testing (no source access): the parts that
// apply to any live site are kept; code-level rules (ESLint, auth wrappers) are not.
//
// Sources in this repo:
//   • docs/uat-rubric.md   — 4 pillars, design 0-5 heuristics, anti-slop tells,
//                            functional case-matrix, UAT traceability.
//   • SECURITY.md §10      — OWASP Top 10 coverage table.
//   • CLAUDE.md            — UI-quality Definition of Done.
// Keep in lockstep with those files when the methodology evolves.

import type { TestDimension } from "@/generated/prisma/client";

const DESIGN_RUBRIC = `Grade against this design rubric (docs/uat-rubric.md Tier 1), scoring the spirit of
each heuristic 0-5 and flagging misses as findings:
- Spacing & rhythm (consistent scale, not cramped/huge dead space); Alignment & grid;
  Visual hierarchy (ONE obvious primary action, not many equal buttons).
- Colour & contrast: copy passes WCAG AA on its actual background; one coherent accent.
- State coverage: real empty / loading / error states (no blank shell, spinner-forever,
  or raw error dump); hover/focus/disabled.
- Consistency of components; Responsive (desktop AND mobile screenshots provided) + RTL + dark if present.
Anti-slop tells to flag (cite this rubric): purple→blue gradients/glow, five equal primary
buttons, nested cards, emoji-as-icons, gray-on-colored text, fake-precise numbers, dead
decorative chrome.`;

const ACCESSIBILITY_RUBRIC = `Grade against WCAG 2.1 AA. The capture ran an axe-core scan — treat any serious/critical
violation as a finding (cite the rule id). Also judge: form inputs have labels, images have
alt text, focus order is logical and visible, colour contrast ≥ AA, content is keyboard-
reachable, and ARIA isn't misused. 0 serious/critical = the bar.`;

const PERFORMANCE_RUBRIC = `Judge against web performance budgets using the captured timing. Rough bars: load < 2.5s good,
2.5-4s needs work, > 4s failing; watch request count and transfer size (heavy pages = many
requests / large transfer). Flag render-blocking patterns, oversized assets, and excessive
third-party requests you can infer from the link/resource signals.`;

const FUNCTIONALITY_RUBRIC = `Apply functional-QA thinking (docs/uat-rubric.md Tier 2): think in a risk-based case matrix,
not "looks fine". Check:
- Every control does something (no dead buttons/links); the primary action is obvious.
- Inputs validate at the boundary with clear messages; required fields enforced.
- Honest feedback (success only on real success; no green toast over an empty result).
- No uncaught console/runtime errors; no broken internal links (the capture HEAD-checked them).
USER STORIES: enumerate the user stories / journeys this page implies (e.g. "as a visitor I can
sign up", "… find pricing", "… contact sales", "… search", "… complete checkout"). For EACH,
judge whether the UI plausibly supports it end-to-end, and flag the broken or missing ones as
findings. Aim to cover every reasonable journey, not just the happy path.`;

const BRD_COVERAGE_RUBRIC = `Build a traceability matrix (docs/uat-rubric.md Tier 3): every requirement → MET / PARTIAL /
MISSING with evidence. Split compound requirements into atomic, independently checkable items.
If no BRD was provided, infer the implied requirements from the page's apparent purpose and
assess those, but note that no formal scope was given.`;

const SECURITY_RUBRIC = `Run a black-box, NON-INTRUSIVE security review against the OWASP Top 10 (SECURITY.md §10) —
observation only, no active exploitation or attacks:
- A01 Access control: are there signs of unauthenticated access to sensitive areas? login present?
- A02 Crypto: HTTPS enforced? HSTS header? mixed (http) content? secure/HttpOnly/SameSite cookie flags?
- A03 Injection: forms present that could be injection surfaces (advisory — not actively tested).
- A05 Misconfiguration: security headers present (CSP, X-Frame-Options/clickjacking, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy)? server/version banners or stack traces exposed?
- A06 Vulnerable components: any disclosed library versions with known issues?
- A07 Auth failures: password fields without obvious protections; no visible rate-limit/lockout cues.
- A09 Logging/monitoring: not observable black-box (note as out of scope).
- A10 SSRF and server-side issues: not testable black-box (note as out of scope).
Cite the OWASP item per finding. Be explicit that this is a passive review, NOT a penetration test.`;

const BENCHMARK_RUBRIC = `Pick 3-5 well-known peer products in the site's apparent domain (infer it), and compare this
site against how those peers do the SAME core flow/screen (docs/uat-rubric.md Benchmark set).
Note where it meets, exceeds, or trails enterprise norms. Advisory — based on general knowledge.`;

export const DIMENSION_RUBRIC: Record<TestDimension, string> = {
  DESIGN: DESIGN_RUBRIC,
  ACCESSIBILITY: ACCESSIBILITY_RUBRIC,
  PERFORMANCE: PERFORMANCE_RUBRIC,
  FUNCTIONALITY: FUNCTIONALITY_RUBRIC,
  BRD_COVERAGE: BRD_COVERAGE_RUBRIC,
  SECURITY: SECURITY_RUBRIC,
  BENCHMARK: BENCHMARK_RUBRIC,
};
