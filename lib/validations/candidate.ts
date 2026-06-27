import { z } from "zod";

// Zod contracts for the candidate runner (ARCHITECTURE §8/§12.4, UI-SPEC C.1–C.4).
// Parsed at the token-authorized API boundary (CLAUDE.md "validate at the API
// boundary with zod"). The token authorizes the write; these validate the payload.

// IPIP-NEO-120: 120 items, 5-point Likert. Bounds are the instrument's, not config.
export const IPIP_ITEM_COUNT = 120;
export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;

// Consent (UI-SPEC C.1). The POST itself is the consent act; `consent` must be the
// literal true (a missing/false flag is a 422, never a silent no-consent write).
// `locale` records the language the candidate consented in.
export const consentSchema = z.object({
  consent: z.literal(true),
  locale: z.enum(["en", "ar"]).optional(),
});
export type ConsentInput = z.infer<typeof consentSchema>;

// One autosaved answer. Discriminated union so an item answer and an SJT answer
// validate against exactly their own shape (UI-SPEC C.2/C.3).
export const responseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    // Canonical IPIP item id (1..120); joins AssessmentItemBank.itemNumber.
    itemNumber: z.number().int().min(1).max(IPIP_ITEM_COUNT),
    // 5-point Likert (Very Inaccurate=1 … Very Accurate=5).
    value: z.number().int().min(LIKERT_MIN).max(LIKERT_MAX),
  }),
  z.object({
    kind: z.literal("sjt"),
    sjtItemId: z.string().cuid(),
    // The chosen option id — its membership in the item's options is verified
    // server-side (zod can't see the item's option set).
    chosenOptionId: z.string().trim().min(1).max(40),
  }),
]);
export type ResponseInput = z.infer<typeof responseSchema>;

// Locale switch persisted on the assessment (UI-SPEC C.5 — switch mid-assessment
// without losing progress). Optional body on routes that accept a locale.
export const localeSchema = z.enum(["en", "ar"]);
