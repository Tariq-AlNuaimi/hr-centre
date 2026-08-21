# Open items — the "come back to this later" backlog

**Snapshot: 2026-08-17.** One place to see everything deferred, waived, dormant, or scheduled in
the repo, so you can pick any of it up cold. This is a **convenience index** — the authoritative
records stay in `docs/findings-register.md` and `SECURITY.md §15/§16`. When you resolve an item,
update the source record; re-generate the gist here if useful.

> **Closed rows live in [`docs/archive/open-items-2026.md`](archive/open-items-2026.md)** (archived
> 2026-08-17). Twelve items closed ✅ DONE / ⬜ MOOT / ❌ WON'T-DO in 2026 moved there so this file
> shows only what is genuinely still open. Nothing was deleted.

**Legend** — Effort: S (hours) · M (a day) · L (multi-day/own program). Blocked-by tells you what
gates it.

| #   | Item                                                      | Category    | Effort       | Blocked by                          |
| --- | --------------------------------------------------------- | ----------- | ------------ | ----------------------------------- |
| 8   | WS-5 embeddings **provider round-trip**                   | AI/RAG      | S once keyed | `EMBEDDINGS_API_KEY` + egress       |
| 9   | `ai-eval` `/ship` gate (dormant)                          | AI quality  | —            | a fork adds `AI_API_KEY` + fixtures |
| 10  | SSO / Microsoft Entra (dormant)                           | Auth        | —            | `AUTH_MICROSOFT_ENTRA_ID_*` env     |
| 11  | Dormant CI (`sast.yml`/`zizmor.yml`/`lhci`/senior-review) | CI/security | —            | paid Actions / handoff              |

---

## A. Actionable now (no external dependency)

**Empty.** Every item that was actionable without an external dependency has shipped — see
`docs/archive/open-items-2026.md`. New items land here as they are raised.

---

## B. Blocked on external config (self-activate when a fork turns them on)

These aren't "unfinished" — they're built and **dormant by design**, waiting on env/keys. No code
work needed to "do" them; they light up on configuration.

- **8. WS-5 embeddings provider round-trip** — the pgvector substrate is verified (`fixed`,
  `tests/integration/pgvector.test.ts`); the provider half (`ragUpsert`/`ragQuery` through
  voyage/cohere) is `waived` until a fork sets `EMBEDDINGS_PROVIDER` + `EMBEDDINGS_API_KEY` with
  egress. **Watch the 1024-vs-1536 dimension trap** — set `EMBEDDINGS_DIMENSIONS` and the
  `vector(N)` column in lockstep. Register: WS-5 (adjudicated SPLIT 2026-07-17).
- **9. `ai-eval` `/ship` gate** — no-op (exit 0) until a fork sets `AI_API_KEY` AND writes
  `tests/ai-evals/*.eval.ts` fixtures; then it enforces. Register: `quality/ai` (adjudicated).
- **10. SSO / Microsoft Entra** — wired in `lib/auth.ts`, dormant until
  `AUTH_MICROSOFT_ENTRA_ID_ID` + `_SECRET` + issuer are set (then a "Sign in with Microsoft" button
  appears; `AUTH_ENFORCE_SSO=true` makes it the only path). SECURITY.md §1 (SSO/OAuth).
- **11. Dormant CI** — `sast.yml` / `zizmor.yml` (PyPI-pinned) / `lhci` / the `senior-code-reviewer`
  workflow are authored but `workflow_dispatch`-only (free-plan / ADR-007/037). They activate at
  `/handoff` to a team with paid Actions. The local `/audit` + `/ship` + post-push agent cover the
  gap meanwhile.

---

## Not included here (intentional, not debt)

- Scaffold/template **stub TODOs** (`scripts/scaffold-ai-endpoint.mjs` prompt-crafting comments,
  `uat-pdf.mjs` `TODO(P#)` report-section anchors) are template placeholders a fork fills in per use,
  not repo backlog.
- The HARNESS-V2 program itself is **CLOSED** (all 48 items done; its closeout record is pinned at
  the archive tag — see `docs/ARCHIVE.md`).

## How to pick something up

1. Read the source record (the register/SECURITY/blueprint pointer on the item).
2. `/blueprint` if it's a real multi-file feature; act directly for the S items.
3. Land it green (`/ship`), update the source record's status, and refresh this index.
