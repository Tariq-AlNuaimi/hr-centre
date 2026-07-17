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
//   * A string/template literal in a user-facing attribute: placeholder, title, alt —
//     both the bare form (`placeholder="x"`) AND the expression-container form
//     (`placeholder={"x"}`, `title={cond ? "a" : "b"}`).
//   * A string/template literal reached as a JSX CHILD through an expression container —
//     `{"Hello"}`, `{cond ? "Active" : "Inactive"}`, `{`Loading`}`, `{"a" + b}`. Only
//     TRANSPARENT wrappers (ternary branches, `&&`/`||`, string `+`) count; a literal
//     inside a `t("…")` call is opaque and correctly NOT flagged. (This closes the
//     JSXExpressionContainer bypass — V2-305 senior-review.)
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

function elementName(el) {
  if (el && el.type === "JSXElement" && el.openingElement) {
    const n = el.openingElement.name;
    if (n && n.type === "JSXIdentifier") return n.name;
  }
  return null;
}

function parentElementName(node) {
  // node is a JSXText; its parent is the enclosing JSXElement/JSXFragment.
  return elementName(node.parent);
}

// A wrapper expression is "transparent" to copy: a literal in one of these positions is
// still user-facing text. `{cond ? "A" : "B"}`, `{cond && "text"}`, `{"a" + b}`. The
// ConditionalExpression `test` and a non-`+` BinaryExpression are NOT transparent (a
// literal there isn't display copy).
function isTransparent(parent, child) {
  switch (parent.type) {
    case "ConditionalExpression":
      return child === parent.consequent || child === parent.alternate;
    case "LogicalExpression":
      return child === parent.left || child === parent.right;
    case "BinaryExpression":
      return parent.operator === "+";
    default:
      return false;
  }
}

// Classify a Literal/TemplateLiteral node by its JSX position, walking UP through
// transparent wrappers (ternary/logical/concat) — so a string reached through a
// JSXExpressionContainer (`{cond ? "A" : "B"}`, `placeholder={"x"}`) is caught, but a
// string inside a `t("…")` call (an opaque CallExpression parent) is NOT. Returns
// { kind: "child" | "attr" | null, attr, element }.
function jsxContext(node) {
  let cur = node;
  let parent = cur.parent;
  while (parent) {
    if (parent.type === "JSXExpressionContainer") {
      const gp = parent.parent;
      if (gp && (gp.type === "JSXElement" || gp.type === "JSXFragment"))
        return { kind: "child", element: elementName(gp) };
      if (gp && gp.type === "JSXAttribute") {
        const name = gp.name && gp.name.name;
        return USER_FACING_ATTRS.has(name) ? { kind: "attr", attr: name } : { kind: null };
      }
      return { kind: null };
    }
    if (parent.type === "JSXAttribute") {
      // a bare literal attribute value (no expression container)
      const name = parent.name && parent.name.name;
      return USER_FACING_ATTRS.has(name) ? { kind: "attr", attr: name } : { kind: null };
    }
    if (isTransparent(parent, cur)) {
      cur = parent;
      parent = parent.parent;
      continue;
    }
    return { kind: null }; // opaque parent (a t() CallExpression, member access, …)
  }
  return { kind: null };
}

// The translatable content of a Literal (string) or TemplateLiteral (its static quasis).
function literalishText(node) {
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : null;
  if (node.type === "TemplateLiteral")
    return node.quasis.map((q) => q.value.cooked ?? "").join(" ");
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
    // A string/template literal reported once from whichever visitor sees it — the
    // Literal + TemplateLiteral visitors cover BOTH the bare attribute form
    // (`placeholder="x"`) and every JSXExpressionContainer form (`{"x"}`,
    // `{cond ? "A" : "B"}`, `placeholder={"x"}`, template literals) via jsxContext.
    function checkLiteralish(node) {
      const text = literalishText(node);
      if (text == null || !TRANSLATABLE.test(text)) return;
      const ctx = jsxContext(node);
      if (ctx.kind === "child") {
        if (ctx.element && RAW_TEXT_ELEMENTS.has(ctx.element)) return; // <code>/<pre>/…
        context.report({
          node,
          messageId: "literalText",
          data: { text: text.trim().slice(0, 40) },
        });
      } else if (ctx.kind === "attr") {
        context.report({
          node,
          messageId: "literalAttr",
          data: { attr: ctx.attr, text: text.trim().slice(0, 40) },
        });
      }
    }
    return {
      // Direct JSX text children (`<button>Save</button>`).
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
      // String literals reached through an expression container / a bare user-facing
      // attribute — the JSXExpressionContainer bypass the JSXText visitor can't see.
      Literal: checkLiteralish,
      TemplateLiteral: checkLiteralish,
    };
  },
};
