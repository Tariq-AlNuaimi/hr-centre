# Plugin-eval — harness skills & agents (2026-07)

**What this is.** The evaluation deliverable for Wave A4's `plugin-eval` item
(`docs/deep-comparison/ADOPT.md`; pattern from wshobson/agents, cat 06). The
adopt-before-use *note* already landed in `.claude/README.md`; this is the actual
**evaluator run** over our own `.claude/skills/*` (24 skills) and `.claude/agents/*`
(2 agents). It is an assessment, not a refactor — findings + concrete, bounded
fixes, no wholesale rewrites.

**Method.** wshobson's `plugin-eval` is a three-layer check (static validity +
LLM-semantic quality + Monte-Carlo trigger simulation). Applied to our stack-bound
harness that reduces to four scored dimensions, each 1–5:

- **DQ — Description quality.** Valid frontmatter (`name`+`description`), third-person,
  says both *what it does* and *when to use it*, front-loads the match-critical words.
- **TC — Trigger clarity.** Concrete, non-generic trigger phrases / slash form / path
  globs an agent (or the advisory `skill-rules.json`) can match without guessing.
- **NO — Non-overlap.** A crisp boundary against its nearest sibling so two skills
  don't both fire on the same request (or, if they legitimately share an entry
  phrase, the description disambiguates).
- **CV — Coverage fit.** The skill occupies a real, needed slot in the lifecycle
  with no dead space or silent gap around it.

Scale: 5 = exemplary, 4 = solid, 3 = works with a noted rough edge, ≤2 = fix before
relying on it. **No skill scored ≤2** — the harness is healthy; findings are edge
polish and a handful of trigger-collision clarifications.

---

## Scorecard

| Skill / agent | DQ | TC | NO | CV | Note (only where < 5) |
|---|:--:|:--:|:--:|:--:|---|
| adr | 5 | 5 | 5 | 5 | — |
| audit | 5 | 4 | 4 | 5 | Shares "security scan" with `/ship`'s secret+dep phase; boundary is real (adds Semgrep SAST, on-demand + path-scoped) but not stated in the description. See F1. |
| batch | 5 | 5 | 5 | 5 | — |
| blueprint | 5 | 5 | 5 | 5 | Now also hosts the grill-against-docs + domain-model steps (A4); still single-purpose (the pre-build contract). |
| conform | 5 | 5 | 5 | 5 | — |
| deploy | 5 | 4 | 4 | 5 | "get me a URL" / "ship it live" overlaps `new-project`; disambiguator (existing GitHub repo, never connected) is present but easy to miss. See F2. |
| design-qa | 5 | 5 | 4 | 5 | Reactive half of the design pair; boundary vs `design-system` is stated. Fine. |
| design-system | 5 | 5 | 4 | 5 | Proactive half; cross-references `design-qa`. Fine. |
| docker | 5 | 5 | 5 | 5 | — |
| first-fork | 5 | 4 | 4 | 5 | Three-way provisioning family (`first-fork` manual / `new-project` automated / `deploy` existing-repo); each states its lane but a new operator can't tell which is theirs from the name alone. See F2. |
| handoff | 4 | 3 | 3 | 5 | Bare word "handoff" is ambiguous with `handoff-session` in natural language. See F3. |
| handoff-session | 5 | 4 | 3 | 5 | Same collision as above (session-continuity vs IT-package). Slash forms are distinct; NL is not. See F3. |
| manual-uat | 5 | 4 | 3 | 5 | Exploratory RBAC/worst-path browser testing vs `uat` FULL's phased audit — both are "deep browser testing"; the happy/worst + live-RBAC framing separates them but "test it in the browser" could hit either. See F4. |
| migrate-from | 5 | 5 | 5 | 5 | — |
| new-project | 5 | 4 | 4 | 5 | See F2 (provisioning family). |
| qa | 5 | 5 | 4 | 5 | The orchestrator; explicitly owns the gated order over `design-qa`/`ship`/`uat`. Good front door — should be the default target for vague "is this ready". |
| quickstart | 5 | 5 | 5 | 5 | — |
| rebrand | 5 | 5 | 5 | 5 | — |
| remember | 5 | 5 | 5 | 5 | — |
| scaffold-entity | 5 | 5 | 5 | 5 | Now cross-references blueprint's domain-model grid (A4). |
| scale-up | 5 | 4 | 4 | 5 | "custom domain" also lives in `new-project` (Cloudflare CNAME) and "self-host" borders `docker`; recipe-vs-provision boundary holds but is implicit. Minor. |
| ship | 5 | 5 | 4 | 5 | See F1 (secret+dep phase overlaps `audit`). |
| sync-from-template | 5 | 5 | 5 | 5 | — |
| uat | 5 | 4 | 3 | 5 | See F4 (FULL mode vs `manual-uat`). |
| **agent: scout** | 5 | 5 | 5 | 5 | Read-only investigator, haiku; boundary vs the harness `Explore`/`general-purpose` agents is clear (repo-scoped, condensed report). |
| **agent: senior-code-reviewer** | 5 | 5 | 5 | 5 | Post-push breadth; description explicitly states it is NOT a replacement for the `/code-review` diff gate. Exemplary boundary statement. |

**Aggregate:** DQ 4.96 · TC 4.63 · NO 4.33 · CV 5.00. The soft spot is **NO
(non-overlap)** — four sibling clusters share an entry phrase. None is a defect;
each is a one-line description clarification.

---

## Findings (concrete, bounded)

**F1 — `audit` ↔ `ship` share "security scan" (NO 4).** Both scan for secrets +
dependency CVEs. Real boundary: `/ship` is the *pre-push full gate* (typecheck +
lint + tests + build + gitleaks + npm-audit) that runs before every push; `/audit`
is the *on-demand, path-scoped* scan that additionally runs **Semgrep SAST** (which
`/ship` does not) and is the first step of `/conform`. *Fix:* add one clause to
`audit`'s description — "distinct from `/ship`'s pre-push gate: on-demand, path-scoped,
adds Semgrep SAST." No behavior change.

**F2 — provisioning family `deploy` / `new-project` / `first-fork` (NO 4).** Three
paths to a live URL, differentiated by starting state (existing repo / brand-new /
manual walkthrough) but sharing "get me a URL"-class triggers. *Fix:* add a single
"choose your lane" line to each of the three descriptions naming the *precondition*
that selects it (already-on-GitHub → `deploy`; nothing yet → `new-project`; doing it
by hand as a non-dev → `first-fork`). Optionally add a 3-row decision table to the
`deploy` SKILL body. Low priority — the bodies already explain it.

**F3 — `handoff` vs `handoff-session` collide on the bare word "handoff" (NO 3).**
Different lifecycle moments (ship-to-IT package vs continue-in-a-fresh-session), but
"handoff" alone matches both in natural language. Slash forms (`/handoff` vs
`/handoff-session`) are unambiguous; the risk is a typed sentence like "let's do a
handoff". `skill-rules.json` already routes "ship to IT" → `handoff` and "wrap up this
session" → `handoff-session`, which mitigates it. *Fix (cheap):* have each
description open by contrasting with the other ("*production* handoff to the IT team —
not the *session* handoff, see `/handoff-session`"). Rename is **not** recommended
(both names are established and correct).

**F4 — `uat` FULL vs `manual-uat` both "deep browser testing" (NO 3).** `uat` is the
*canned* two-mode runner (LEAN smoke / FULL phased audit + PDF); `manual-uat` is the
*exploratory, judgment-driven* pass (real user, worst-path, live RBAC per role). The
distinction is canned-vs-exploratory, but a vague "test it in the browser" could pick
either. *Fix:* `uat`'s description already says "the canned complement"; add the mirror
clause to nothing new — instead ensure `qa` (the orchestrator) is the advertised front
door for "is this ready", and that `skill-rules.json`'s `qa` row stays the catch-all
for vague test asks (it does). No file change strictly required; documented here so the
boundary is on record.

**F5 — description-format inconsistency (DQ, cosmetic).** Most skills end with an
explicit `Trigger phrases:` list; a handful (`adr`, `rebrand`, `docker`, `first-fork`,
`migrate-from`) fold triggers into "Use when the user says …" prose instead. Both are
matchable; the inconsistency is purely stylistic. *Fix (optional, batchable):*
normalize on a trailing `Trigger phrases:` clause when these skills are next touched —
not worth a dedicated pass.

---

## Coverage assessment

- **No lifecycle gap found.** Define (`blueprint` + the new domain-model/grill steps),
  provision (`new-project`/`first-fork`/`deploy`/`rebrand`), build (`scaffold-entity`/
  `quickstart`/`design-system`), verify (`ship`/`qa`/`design-qa`/`uat`/`manual-uat`/
  `audit`), review (`scout` + `senior-code-reviewer` + the native `/code-review`),
  operate/grow (`scale-up`/`docker`/`migrate-from`/`sync-from-template`), and remember
  (`remember`/`handoff-session`/`handoff`) are all occupied.
- **Deliberate non-skills.** `/code-review` is provided natively (referenced by
  `skill-rules.json`, not a `.claude/skills/*` dir) — correct, don't duplicate it.
  `/domain-modeling` and `/grill-with-docs` are folded into `/blueprint` rather than
  standalone skills (A4 decision, ADR-022 native-over-imported) — intentional, not a
  gap.
- **Known future slots (already tracked in ADOPT.md, not gaps here):** AI test-gen +
  coverage-fed test authoring (A5), observability/session-analytics (A3/deferred),
  `/manual-uat` record-to-spec (A5). Flagged so this eval isn't read as "add them now."

## Recommended action

Adopt **F1** and **F3** (one-clause description edits) when those skills are next
touched — they remove the two most real natural-language collisions for near-zero cost.
**F2/F4/F5** are documented-and-deferred: correct as-is, polish opportunistically.
No skill needs restructuring; the `plugin-eval` verdict is **harness healthy, boundaries
sound, four sibling clusters worth a one-line disambiguation each.**

## Cross-references
- ADOPT.md Wave A4 · `.claude/README.md` (plugin-eval note) · `.claude/skill-rules.json`
  (advisory activation map, consulted for the NO dimension) · cat 06
  (`docs/deep-comparison/06-frameworks.md`, the `plugin-eval` source row).
