# ADR-084 — `@react-pdf/renderer` for the hiring offer letter

Status: accepted (operator-authorised dependency for the Hiring port, 2026-10-26) · Blueprint:
`docs/blueprints/hiring-offers.md`

## Context

Interview Hub generates the offer letter as a PDF on the server: an admin-editable opening
paragraph with merge fields, then a terms box filled from the offer. HR previews it from the offer
screen and sends it to the candidate. HR Centre had no PDF generator: the people module's
documents are uploaded files, and JML's documents are Word templates (docxtemplater, its own ADR).

## Options

1. **`@react-pdf/renderer` 4.9.0** (MIT; the library Interview Hub used). Declarative React
   components, built-in Helvetica (no font files to ship or trace in serverless), renders to a
   Buffer in a Node route. Large (~10 MB installed with its font and layout engines) but SERVER-ONLY
   here: imported only by `lib/hiring/offer-letter.tsx`, reached only from the letter route, so it
   never enters a client bundle.
2. **`pdf-lib`** — lower level: every line, wrap and page break by hand. Less weight, much more
   layout code to own for a one-page letter.
3. **A Word template (docxtemplater) like JML** — HR would get a .docx, not the PDF Interview Hub
   gave them; and the candidate letter would need converting before sending.
4. **Headless Chrome (HTML → PDF)** — no Chromium on Vercel functions without a large layer.

## Decision

Option 1, server-only. D11 is fixed on the way: the default template and the terms box state the
basic salary as MONTHLY, with each allowance and the total monthly package listed.

## Consequences

- One runtime dependency, never shipped to the browser (the route is `runtime = "nodejs"`).
- The letter carries pay, so the route requires `hiring.manage` AND compensation access; it is
  `no-store` and never cached.
- The opening paragraph is the `offerLetter.template` hiring setting (≤ 20,000 characters, hiring
  admin only); unknown `[tokens]` are left visible rather than blanked.
