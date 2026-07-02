// Lighthouse-CI config (ADOPT Wave A3 — scored lab audit of a preview URL).
//
// DORMANT / optional by design, consistent with the template's dormant-CI pattern:
// nothing runs it automatically. Invoke ad-hoc from any machine with:
//   LHCI_URL=https://<fork-preview>.vercel.app/en npm run lhci
// or override the target on the CLI: `npm run lhci -- --collect.url=<url>`.
// Wire it into `.github/workflows/*` as a per-PR assertion when Actions activate
// (the same trigger that activates the other dormant workflows). For interactive,
// trace-level digging from a session, use chrome-devtools-mcp instead (docs/mcp.md).
//
// `.cjs` (not `.js`): package.json is `"type": "module"`, so a `.js` config would be
// loaded as ESM and `module.exports` would fail. `.cjs` keeps this CommonJS.

// Default target: a preview URL passed via LHCI_URL. Falls back to a local `next
// start` server on :3000 so a fork can smoke it locally before it has a preview.
const url = process.env.LHCI_URL || "http://localhost:3000/en";
const isLocal = !process.env.LHCI_URL;

module.exports = {
  ci: {
    collect: {
      url: [url],
      numberOfRuns: 3,
      // Only boot a local server when auditing localhost; when LHCI_URL points at
      // a deployed preview, collect against it directly (no local server).
      ...(isLocal
        ? { startServerCommand: "npm run start", startServerReadyPattern: "Ready" }
        : {}),
    },
    assert: {
      assertions: {
        // Performance is the Pillar-1 signal — warn (not error) so an ad-hoc run
        // surfaces regressions without hard-failing a dormant check.
        "categories:performance": ["warn", { minScore: 0.9 }],
        "categories:accessibility": ["warn", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
      },
    },
    upload: {
      // No LHCI server configured for the prototype rail; publish the report to
      // Lighthouse-CI's temporary public storage so the run prints a shareable URL.
      target: "temporary-public-storage",
    },
  },
};
