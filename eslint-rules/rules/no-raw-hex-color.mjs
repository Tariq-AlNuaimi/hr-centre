// Rule: no-raw-hex-color
//
// Design-token enforcement. Color must come from the theme tokens
// (components/layout/antd-theme.ts) or the CSS custom properties in
// app/tokens.css -- never a raw hex literal dropped into a component
// (e.g. `style={{ color: "#3a3a3a" }}` or a one-off palette array). Raw
// hexes are how a considered theme drifts back to generic: off-palette
// hues, values that ignore dark mode, colors that can't be rebranded in
// one place. This rule keeps the design system the single source of truth.
//
// What it flags: a string literal that IS a hex color (#rgb / #rgba /
// #rrggbb / #rrggbbaa) or that embeds a 6-/8-digit hex color. Comments are
// not literals, so example hexes in docs/comments are fine.
//
// Exempt: the token source file itself (antd-theme.ts) -- that's where brand
// colors and the chart palette legitimately live. To use a justified literal
// elsewhere (rare), disable per line:
//   // eslint-disable-next-line rihal-template/no-raw-hex-color
//
// CSS files (tokens.css / globals.css) are out of scope for this rule -- ESLint
// lints JS/TS, not CSS. Keep palette hexes there reviewed by hand.

const WHOLE_HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// A 6- or 8-digit hex embedded in a larger string (e.g. "1px solid #1677ff"),
// bounded so it isn't part of a longer hex/word run.
const EMBEDDED_HEX = /(?:^|[^0-9a-fA-F])#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?(?![0-9a-fA-F])/;

const EXEMPT_FILE = /antd-theme\.ts$/;

function isHexColor(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return WHOLE_HEX.test(trimmed) || EMBEDDED_HEX.test(value);
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw hex color literals in components; color must come from the theme tokens or CSS custom properties.",
    },
    messages: {
      noRawHexColor:
        "Raw hex color \"{{value}}\". Color must come from the theme tokens (components/layout/antd-theme.ts via theme.useToken()) or a CSS variable in app/tokens.css -- a hardcoded hex drifts off-palette and ignores dark mode. Move it to the token layer, or disable this line with a justification if it's genuinely one-off.",
    },
    schema: [],
  },
  create(context) {
    const filename =
      (typeof context.filename === "string" && context.filename) ||
      (typeof context.getFilename === "function" && context.getFilename()) ||
      "";
    if (EXEMPT_FILE.test(filename)) return {};

    function check(node, value) {
      if (isHexColor(value)) {
        context.report({
          node,
          messageId: "noRawHexColor",
          data: { value: String(value).trim().slice(0, 40) },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      // Template literals with no interpolation, e.g. `#1677ff`.
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          check(node, node.quasis[0].value.cooked);
        }
      },
    };
  },
};
