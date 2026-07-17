// Rule: no-literal-jsx-text  (V2-305 — the copy chokepoint)
//
// Every user-facing string must go THROUGH next-intl (`t("namespace.key")`), so that
// `messages/*.json` is the single place copy lives — the chokepoint the copy-lint gate
// (scripts/copy-check.mjs) then holds to a house style. A raw literal dropped into JSX
// ("Save", <span>Delete</span>, placeholder="Search…") bypasses that: it is untranslated,
// unlinted, and invisible to the copy gate. This rule is the enforcement — the i18n
// sibling of the design-token rules (no-raw-hex-color, no-arbitrary-className): color and
// spacing come from a scale, and copy comes from the message catalog.
//
// What it flags:
//   * JSXText with translatable content — a run of ≥2 letters, e.g. <button>Save</button>,
//     <p>No results found</p>. (Pure whitespace / punctuation / digits / symbols like
//     "•", "—", "×", "/", "42" are NOT copy and are left alone.)
//   * A bare string literal in a user-facing attribute: placeholder, title, alt.
//
// Allowlist (per the V2-305 spec — aria / test ids / dev pages):
//   * aria-* and data-* attributes are never flagged (aria carries tokens/labels handled
//     separately; data-testid is test infra, not copy).
//   * Only placeholder/title/alt are user-facing attributes; every OTHER attribute
//     (className, id, type, role, href, htmlFor, …) is ignored — a curated opt-in set,
//     so the rule is inherently low-false-positive.
//   * Text inside code/pre/kbd/samp/var is literal by nature (code samples, shortcuts) and
//     is not copy.
//   * Dev / reference pages (the style-guide) are turned off at the config layer
//     (eslint.config.mjs `files` override), not here.
//
// Escape hatch (a genuine non-copy literal — a brand mark, a symbol the heuristic misses):
//   {/* eslint-disable-next-line rihal-template/no-literal-jsx-text */}
//   <span>…</span>

// A translatable segment: at least one run of two or more Unicode letters. Single letters,
// digits, punctuation and symbols alone are not copy.
const TRANSLATABLE = /\p{L}{2,}/u;

// Elements whose text children are literal by nature (not UI copy).
const RAW_TEXT_ELEMENTS = new Set(["code", "pre", "kbd", "samp", "var"]);

// The only attributes whose bare string value is user-facing copy. Everything else
// (className, id, type, role, href, aria-*, data-*, …) is ignored.
const USER_FACING_ATTRS = new Set(["placeholder", "title", "alt"]);

function parentElementName(node) {
  // node is a JSXText; its parent is the enclosing JSXElement/JSXFragment.
  const parent = node.parent;
  if (parent && parent.type === "JSXElement" && parent.openingElement) {
    const n = parent.openingElement.name;
    if (n && n.type === "JSXIdentifier") return n.name;
  }
  return null;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow literal user-facing text in JSX (text nodes + placeholder/title/alt); route copy through next-intl so messages/*.json stays the single copy chokepoint.",
    },
    messages: {
      literalText:
        'Literal JSX text "{{text}}" — user-facing copy must go through next-intl: `{t("namespace.key")}` with the string in messages/*.json (the copy chokepoint the copy-lint gate checks). Wrap it in a translation, or disable this line for a genuine non-copy literal.',
      literalAttr:
        'Literal "{{attr}}" text "{{text}}" — a user-facing attribute must be translated: `{{attr}}={t("namespace.key")}`. aria-*/data-* are exempt; disable this line for a genuine non-copy value.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        const raw = typeof node.value === "string" ? node.value : "";
        if (!TRANSLATABLE.test(raw)) return;
        const parentName = parentElementName(node);
        if (parentName && RAW_TEXT_ELEMENTS.has(parentName)) return;
        context.report({
          node,
          messageId: "literalText",
          data: { text: raw.trim().slice(0, 40) },
        });
      },
      JSXAttribute(node) {
        const name = node.name && node.name.name;
        if (typeof name !== "string" || !USER_FACING_ATTRS.has(name)) return;
        const v = node.value;
        // Only a bare string literal is copy; `placeholder={t("…")}` is a
        // JSXExpressionContainer and is exactly what we want, so it is never flagged.
        if (!v || v.type !== "Literal" || typeof v.value !== "string") return;
        if (!TRANSLATABLE.test(v.value)) return;
        context.report({
          node,
          messageId: "literalAttr",
          data: { attr: name, text: v.value.slice(0, 40) },
        });
      },
    };
  },
};
