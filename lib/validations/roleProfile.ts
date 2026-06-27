import { z } from "zod";
import { IPIP_FACETS } from "../ipip-facets";

// Zod contracts for role-profile authoring (ARCHITECTURE §5/§12.3, UI-SPEC D.3).
// Parsed at the API boundary (CLAUDE.md "Validate at the API boundary with zod").
// The same competency shape is reused for the AI Role 1 draft response so a draft
// is held to exactly the constraints a human-authored profile is.

// A facet must be one of the 30 real IPIP-NEO facets (lib/ipip-facets). z.enum
// needs a non-empty tuple; IPIP_FACETS is a fixed 30-element list.
const facetSchema = z.enum(IPIP_FACETS as unknown as [string, ...string[]]);

export const bandDirectionSchema = z.enum(["HIGH", "MODERATE", "LOW"]);

// One competency row (UI-SPEC D.3 step 3). targetPercentile is a community
// percentile threshold (1..99); weight drives the fit roll-up and must be > 0.
export const competencyInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  onetRef: z.string().trim().max(120).optional().nullable(),
  importance: z.number().min(0).max(100).optional().nullable(),
  weight: z.number().positive().max(100).default(1),
  direction: bandDirectionSchema.default("HIGH"),
  targetPercentile: z.number().int().min(1).max(99).default(50),
  sourceCitation: z.string().trim().max(500).optional().nullable(),
  // At least one mapped facet -- a competency the bank can't measure is useless.
  facets: z.array(facetSchema).min(1).max(8),
});
export type CompetencyInput = z.input<typeof competencyInputSchema>;
export type CompetencyValue = z.output<typeof competencyInputSchema>;

// One option of an SJT item. EN required; AR optional (translated in place).
const sjtOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text_en: z.string().trim().min(1).max(2000),
  text_ar: z.string().trim().max(2000).optional().nullable(),
});

// An SJT item (UI-SPEC C.3/D.3 step 4). scoringKey is admin-only and references
// option ids; superRefine guarantees the keyed ids actually exist in options so a
// profile can never be approved with a dangling/ambiguous key.
export const sjtItemInputSchema = z
  .object({
    scenario_en: z.string().trim().min(4).max(4000),
    scenario_ar: z.string().trim().max(4000).optional().nullable(),
    options: z.array(sjtOptionSchema).min(2).max(8),
    scoringKey: z.object({
      bestOptionId: z.string().trim().min(1),
      worstOptionId: z.string().trim().min(1).optional().nullable(),
    }),
  })
  .superRefine((item, ctx) => {
    const ids = new Set(item.options.map((o) => o.id));
    if (ids.size !== item.options.length) {
      ctx.addIssue({ code: "custom", message: "option ids must be unique", path: ["options"] });
    }
    if (!ids.has(item.scoringKey.bestOptionId)) {
      ctx.addIssue({ code: "custom", message: "bestOptionId is not an option id", path: ["scoringKey", "bestOptionId"] });
    }
    const worst = item.scoringKey.worstOptionId;
    if (worst && !ids.has(worst)) {
      ctx.addIssue({ code: "custom", message: "worstOptionId is not an option id", path: ["scoringKey", "worstOptionId"] });
    }
  });
export type SjtItemInput = z.input<typeof sjtItemInputSchema>;
export type SjtItemValue = z.output<typeof sjtItemInputSchema>;

// Create a new DRAFT profile (POST /api/role-profiles). competencies/sjtItems may
// be empty at create (blank wizard) and filled before approval.
export const createRoleProfileSchema = z.object({
  roleFamilyId: z.string().cuid(),
  title: z.string().trim().min(2).max(160),
  jdSourceText: z.string().trim().max(20000).optional().nullable(),
  isAiDrafted: z.boolean().default(false),
  competencies: z.array(competencyInputSchema).max(40).default([]),
  sjtItems: z.array(sjtItemInputSchema).max(40).default([]),
});
export type CreateRoleProfileInput = z.input<typeof createRoleProfileSchema>;
export type CreateRoleProfile = z.output<typeof createRoleProfileSchema>;

// Edit a DRAFT/IN_REVIEW profile (PUT /api/role-profiles/[id]). Title + the full
// competency/SJT set are replaced wholesale (the wizard owns the whole document).
// roleFamilyId is immutable after create, so it is not editable here.
export const updateRoleProfileSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  jdSourceText: z.string().trim().max(20000).optional().nullable(),
  status: z.enum(["DRAFT", "IN_REVIEW"]).optional(),
  competencies: z.array(competencyInputSchema).max(40).optional(),
  sjtItems: z.array(sjtItemInputSchema).max(40).optional(),
});
export type UpdateRoleProfileInput = z.input<typeof updateRoleProfileSchema>;
export type UpdateRoleProfile = z.output<typeof updateRoleProfileSchema>;

// AI Role 1 draft request (POST /api/role-profiles/draft). The JD + family the LLM
// structures a profile from. min length so an empty JD can't trigger a hallucinated
// profile from nothing.
export const draftRoleProfileSchema = z.object({
  roleFamilyKey: z.string().trim().min(1).max(60),
  roleTitle: z.string().trim().min(2).max(160),
  jdSourceText: z.string().trim().min(40).max(20000),
});
export type DraftRoleProfileInput = z.input<typeof draftRoleProfileSchema>;

// The structured draft the LLM must return (ARCHITECTURE §4: "Output is strict
// JSON against a schema"). Reuses competencyInputSchema so the model is held to the
// same facet/percentile/weight constraints a human is -- anything off-contract is
// rejected and the wizard falls back to manual. SJT drafting is deferred (Phase 4).
export const llmDraftResponseSchema = z.object({
  competencies: z.array(competencyInputSchema).min(1).max(40),
});
export type LlmDraftResponse = z.infer<typeof llmDraftResponseSchema>;
