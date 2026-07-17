# ADR-062 — Plugin publish-readiness: prepare, do not publish

**Status:** Accepted (2026-07-18, Tariq Al-Naaimi — operator chose "prepare, don't publish" for the
deferred #22). **Amends** ADR-054's private-posture amendment (2026-07-13): the `.claude/` plugin is
now formally **publication-ready**; publication itself stays a deliberate, operator-run step and is
**not** performed. Nothing is published by this ADR.
**Date:** 2026-07-18
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Amends:** ADR-054 (harness plugin + agent-eval — the private/internal posture this refines).
**Relates to:** V2-503 (agentskills.io conformance + the `skill-check` gate), `.claude/plugin.json`.

## Context

ADR-054 bundled `.claude/` as a versioned Claude Code plugin (`plugin.json`) with a deliberate
**private/internal** posture: versioning + `/handoff` portability only, **not** published to any
marketplace, "if a public/marketplace channel is ever adopted, relocate per the official plugin spec
(`.claude-plugin/plugin.json`) and record a superseding ADR." harness-v2 then made the plugin more
publishable — V2-503 validated all skills against the agentskills.io open standard and wired
`skill-check` into `/ship`, and refreshed `plugin.json` (version 0.2.0, `x-conformance`). The deferred
**#22** asked whether to actually publish. The operator's decision: **prepare, don't publish.**

## Decision drivers

- Publishing to a public marketplace is **outward-facing and hard to reverse** — it puts the harness
  under the org's name publicly and invites external consumers; that is the operator's call to make
  and own, not an autonomous agent's.
- The plugin is genuinely close to publish-ready (conformance gated, versioned) — the value is in
  making publication a **config flip + a checklist**, not a rewrite, whenever the operator decides.
- A superseding ADR is required by ADR-054's own terms to change the posture.

## Considered options

### Option 1 — Prepare, do not publish (chosen)

Record the posture change from "never published" to "**publication-ready; unpublished by default;
publication is a deliberate operator step**," and commit a publish-readiness checklist
(`docs/plugin-publish-readiness.md`). No marketplace manifest is created, nothing is pushed to any
registry.

- Good, because it captures the readiness (a fork/operator can publish on a checklist, not a project).
- Good, because the irreversible, org-representing act stays a human decision.
- Good, because it costs nothing to sit ready and drifts nothing (the `skill-check` gate keeps it
  conformant).
- Bad, because "ready but unpublished" is a state someone must remember exists — mitigated by the
  committed checklist + this ADR.

### Option 2 — Publish now

Flip the posture and publish to a public marketplace this session.

- Bad, because it is outward-facing + hard to reverse, and the operator explicitly did not choose it.
- Bad, because it would require picking a registry/channel and org branding decisions that are the
  operator's to own.

### Option 3 — Keep fully private (no change)

Leave ADR-054's private posture untouched.

- Bad, because it drops the readiness signal V2-503 earned — a future publish would re-derive "is it
  ready?" instead of running a checklist.

## Decision

**Adopt Option 1.** The `.claude/` plugin is **publication-ready and intentionally unpublished.**
Publication, if ever chosen, follows `docs/plugin-publish-readiness.md` (relocate to
`.claude-plugin/plugin.json` per the official spec, pick a channel, decide licensing/branding,
release via changesets) — a deliberate operator step, recorded as its own superseding ADR at that
time. This ADR performs no publication.

## Consequences

**Positive:** the readiness is captured + kept fresh by the `skill-check` gate; publishing later is a
checklist, not a project; the irreversible act stays with the operator. **Negative:** a "ready but
unpublished" state to remember — the committed checklist + this ADR are the reminder. **Mitigations:**
`plugin.json` `x-posture` already points here; the closeout deferrals list records #22 as
"ready, intentionally unpublished."

## Related

- ADR-054 (plugin + agent-eval — the posture this refines); V2-503 (conformance gate);
  `docs/plugin-publish-readiness.md` (the checklist); `.claude/plugin.json`.
