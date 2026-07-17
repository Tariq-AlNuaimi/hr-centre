// Rule: no-arbitrary-className  (V2-304 — spacing/typography lint)
//
// Design-token enforcement for LAYOUT, the sibling of no-raw-hex-color (which does color).
// Spacing and type must come from the scale (the 4px `--space-*` steps / Tailwind `p-*`,
// `gap-*`; the `--font-size-*` / `text-xs…text-h1` type scale), never a one-off arbitrary
// value dropped into a className — `p-[13px]`, `gap-[7px]`, `text-[15px]` are how a
// considered spacing/type rhythm drifts back to ad-hoc pixels that ignore the scale.
//
// What it flags — an arbitrary value ONLY on the utilities the scale governs:
//   * spacing: p/px/py/pt/pb/pl/pr, m/mx/my/mt/mb/ml/mr, gap/gap-x/gap-y, space-x/space-y
//     with a `[...]` value, e.g. `p-[13px]`, `mt-[7px]`, `gap-[5px]`.
//   * font size: `text-[…px|rem|em…]`, e.g. `text-[15px]` (a length — NOT `text-[color]`,
//     `text-[var(--x)]`, which are colors and stay allowed).
// Deliberately NOT flagged: legit arbitrary values elsewhere — `grid-cols-[1fr_auto]`,
// `w-[calc(100%-2rem)]`, `min-h-[44px]` (touch target), `top-[3px]`, arbitrary variants
// (`data-[state=open]:`, `[&::-webkit…]`). The scope is spacing + font size, per V2-304.
//
// Escape hatch (a justified one-off, e.g. an outsize display number with no token):
//   // eslint-disable-next-line rihal-template/no-arbitrary-className

const ARBITRARY_SPACING = /\b(?:p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-\[[^\]]+\]/g;
// A font-size arbitrary value is a LENGTH: an optional `length:` type hint, an optional
// sign, a number, then a px/rem/em unit — `text-[15px]`, `text-[1.375rem]`, `text-[.9em]`,
// `text-[length:14px]`. The unit must TRAIL A DIGIT, so an arbitrary COLOR / named token /
// theme() / CSS-var whose name merely CONTAINS the letters px|rem|em as a substring stays
// allowed: `text-[var(--element-color)]`, `text-[system-ui]`, `text-[theme(spacing.4)]`,
// `text-[var(--primary-emphasis)]` (this repo's own token) are NOT font sizes, NOT flagged.
// (Anchoring the unit to a digit is the V2-304 senior-review fix.)
const ARBITRARY_FONT_SIZE = /\btext-\[(?:length:)?-?[\d.]+(?:px|rem|em)\]/g;

// Return EVERY off-scale utility in the string (not just the first) so a developer sees
// all violations in one lint pass, not one-per-rerun.
function offending(value) {
  if (typeof value !== "string" || !value.includes("[")) return [];
  const hits = [];
  for (const re of [ARBITRARY_SPACING, ARBITRARY_FONT_SIZE]) {
    for (const m of value.matchAll(re)) hits.push(m[0]);
  }
  return hits;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow arbitrary Tailwind values on spacing (p/m/gap/space) and font-size (text-[…px]); use the 4px scale / type scale tokens.",
    },
    messages: {
      noArbitrary:
        'Arbitrary Tailwind value "{{value}}" on a spacing/font-size utility. Spacing comes from the 4px scale (p-*/gap-* steps) and type from the type scale (text-xs…text-h1) — an arbitrary [px] drifts off-scale. Use the nearest token, or add one to app/tokens.css / brand.config.ts; disable this line with a justification if it is a genuine one-off.',
    },
    schema: [],
  },
  create(context) {
    function check(node, value) {
      for (const hit of offending(value)) {
        context.report({ node, messageId: "noArbitrary", data: { value: hit.slice(0, 40) } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        // check each static chunk of a template literal (e.g. `p-2 ${x} text-[15px]`)
        for (const q of node.quasis) check(node, q.value.cooked ?? "");
      },
    };
  },
};
