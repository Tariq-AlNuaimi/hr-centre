# MCP servers — what's wired and why

Project-level MCP config lives in `.mcp.json`. Keep the set small: the token
policy (`docs/token-policy.md`) warns at >3 configured servers — every server's
tool schemas are a per-session context tax. Evidence layer for these choices:
`docs/deep-comparison/05-mcp.md` (cat 05) and `07-scalability.md` (cat 07).

## Wired by default

| Server                               | Purpose                                                | Access                           |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------- |
| `playwright` (`@playwright/mcp`)     | Browser engine for `/uat`, `/design-qa`, `/manual-uat` | Drives a sandboxed browser       |
| `context7` (`@upstash/context7-mcp`) | Current library docs for the locked stack              | **Read-only** (docs lookup only) |

**context7** injects up-to-date, version-correct library documentation into the
session via two tools (`resolve-library-id`, `get-library-docs`). The locked
stack (ADR-001) sits on fast-moving majors — Next 16, Prisma 7, Auth.js v5,
AntD 6 — where model knowledge drifts toward deprecated APIs; when working
against any of these, resolve the library and pull current docs instead of
answering from memory. It is strictly read-only and outbound-only: it never
sees the repo, the database, or any Restricted data — it fetches public docs,
nothing else. No API key required (an optional `CONTEXT7_API_KEY` raises rate
limits; never commit it — SECURITY.md §1).

## As-needed (wire for the session, then remove)

**chrome-devtools-mcp** (`npx chrome-devtools-mcp@latest`) — CDP performance
traces, `lighthouse_audit`, network/console inspection against a real Chrome.
Complements (does not replace) playwright-mcp: add it when a fork needs Core
Web Vitals or trace-level speed validation, then drop it — see the
"Performance measurement" recipe in `.claude/skills/scale-up/SKILL.md`.

**postgres-mcp** and **k6-mcp-server** are `/scale-up` recipes (live DB tuning
and load testing), not default wiring — see `.claude/skills/scale-up/SKILL.md`
§12–13.
