# Plugin publish-readiness checklist (#22, ADR-062)

The `.claude/` harness is packaged as a Claude Code plugin (`.claude/plugin.json`, ADR-054) and is
**publication-ready but intentionally unpublished** (ADR-062, operator decision "prepare, don't
publish"). This is the checklist to run **if the operator ever decides to publish** — it turns
publication into a config flip + a deliberate step, not a project. Publishing is outward-facing and
hard to reverse; it stays the operator's call.

## State today (ready)

- [x] Versioned plugin manifest — `.claude/plugin.json` (name, version 0.2.0, description, author,
      license, components map). Bumped via `@changesets` (ADR-054 `x-versioning`).
- [x] All 34 skills conform to the **agentskills.io open standard**, gated in `/ship`
      (`scripts/skill-standard-check.mjs`, V2-503) — so the skill layer won't drift out of spec.
- [x] Agents, hooks, skill-rules, statusline enumerated in `plugin.json` `x-components`.
- [x] License field present (`UNLICENSED` today — see the decision below before publishing).
- [x] Golden-set agent-eval seeds (`tests/agent-evals/*`) + observe-only routing receipts (ADR-054).

## To do at publish time (the deliberate step)

1. [ ] **Decide licensing + branding.** `plugin.json` `license` is `UNLICENSED` and the name is
       `rihal-prototype-harness` (org-branded). Publishing publicly means choosing a real license
       (e.g. MIT/Apache-2.0 or an explicit proprietary EULA) and confirming the org is comfortable
       with the name/branding being public. This is the irreversible, org-representing call.
2. [ ] **Relocate to the official plugin spec.** Move `.claude/plugin.json` →
       `.claude-plugin/plugin.json` per the current Claude Code plugin spec (ADR-054 named this), and
       add a marketplace manifest (`.claude-plugin/marketplace.json`) if the target channel needs one.
       Verify against the then-current spec — it may have moved since 2026-07.
3. [ ] **Pick the channel.** A public marketplace, an org-internal marketplace, or a git-URL install.
       Each has different discovery + trust implications; record the choice.
4. [ ] **Scrub the payload.** The plugin ships `.claude/` only — confirm no template-dev history or
       secrets ride along (the `docs/` payload is separate; `rebrand --prune-docs`, V2-506, governs
       that). `gitleaks` + a manual pass over `plugin.json`/skills.
5. [ ] **Release via changesets.** `npm run changeset` (per harness-visible change) →
       `changeset:version` → tag → publish to the chosen channel. Mirror the version into
       `plugin.json`.
6. [ ] **Record a superseding ADR.** ADR-062 prepared readiness but published nothing; the act of
       publishing is its own decision — write the superseding ADR (channel, license, version) at that
       time, and flip `plugin.json` `x-posture` from private to the chosen public posture.
7. [ ] **Set up update flow.** Confirm forks can `plugin install`/upgrade + pin a version, and that
       `Renovate` (V2-502) or the equivalent keeps the pin fresh so pinning doesn't rot.

## Do NOT (without explicit operator action)

- Publish to any registry, create a public marketplace entry, or push the plugin under the org's name.
- Change `plugin.json` `license` or `x-posture` to a public value — that is the publish decision, made
  in a superseding ADR, not a drive-by edit.
