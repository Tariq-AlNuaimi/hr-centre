// Rule: no-direct-anthropic-sdk
//
// Model access MUST go through the `@/lib/ai` barrel, never a raw
// `@anthropic-ai/sdk` import in feature code. The barrel (lib/ai) owns the ONE
// configured, endpoint-agnostic client (provider.ts) + the native Tool-Runner
// wrapper (tool-runner.ts): auth-style pinning, the isAiConfigured() gate, the
// default model/max_tokens, and the GenAI-semconv tracing seam all live there.
// A route that does `new Anthropic(...)` (or even imports the SDK types) bypasses
// every one of those invariants -- the very "model access only via @/lib/ai"
// promise CLAUDE.md, ADR-042 (AI-Quality pillar), and docs/uat-rubric.md make.
//
// This rule allowlists the files that legitimately own the SDK seam (everything
// under lib/ai/**: provider.ts constructs the client, tool-runner.ts types off the
// beta Tool-Runner API) and fails `/ship` on an `@anthropic-ai/sdk` import anywhere
// else. Deep imports (`@anthropic-ai/sdk/resources`, `@anthropic-ai/sdk/...`) are
// caught too, so a sub-path import can't slip past.
//
// Matching is by the IMPORT SOURCE path (the module specifier), mirroring the
// import-path-scoped shape of no-prisma-unfiltered-import: the allowlist is a
// directory fragment (`/lib/ai/`), and the banned specifier is the SDK package
// name (or a `@anthropic-ai/sdk/` sub-path). Adding a file to the allowlist is an
// Ask-before change (CLAUDE.md): a new legitimate SDK consumer belongs inside
// lib/ai, not scattered across routes. If a one-off is genuinely justified,
// suppress on the import line with a reason (the single-line-disable convention).
//
// Known limitations (consistent with the sibling rules' accepted gaps):
//   - Static import/export/`import()` forms are tracked. A `require()` or a
//     computed dynamic specifier is not -- these don't appear in this ESM
//     codebase and would stand out in review; a justified suppress is the tool if
//     one ever appears.

// Directory fragment (normalized to forward slashes) whose files may import the
// SDK directly. lib/ai/** is the ONE seam that owns the Anthropic client + types.
const ALLOWED_DIR_FRAGMENT = "/lib/ai/";
const SDK_PACKAGE = "@anthropic-ai/sdk";

function isAllowedFile(filename) {
  if (!filename) return false;
  return filename.replace(/\\/g, "/").includes(ALLOWED_DIR_FRAGMENT);
}

function isSdkSource(value) {
  return (
    typeof value === "string" &&
    (value === SDK_PACKAGE || value.startsWith(`${SDK_PACKAGE}/`))
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict direct `@anthropic-ai/sdk` imports to the lib/ai/** seam. Model access must go through the `@/lib/ai` barrel (provider + Tool-Runner wrapper) so the isAiConfigured() gate, endpoint-agnostic client, default model/max_tokens, and GenAI tracing invariants can't be bypassed (CLAUDE.md; ADR-042 AI-Quality pillar).",
    },
    messages: {
      directSdkImport:
        "`@anthropic-ai/sdk` must not be imported here -- model access goes through the `@/lib/ai` barrel (never a raw `new Anthropic(...)`). Only lib/ai/** owns the SDK seam (provider.ts / tool-runner.ts). Import `runAgent` / `getAiClient` / the AI types from `@/lib/ai`; if you genuinely need the raw SDK here, this is an Ask-before change -- add the file under lib/ai, or suppress on this line with a justification.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowedFile(filename)) return {};

    function check(node) {
      // node.source is a string Literal for import/export-from/import() forms.
      if (node.source && isSdkSource(node.source.value)) {
        context.report({ node: node.source, messageId: "directSdkImport" });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check, // dynamic import("@anthropic-ai/sdk")
    };
  },
};
