# Blueprints

Pre-build contracts produced by `/blueprint` for real (full-track) features —
one `*.md` per feature. Each pins down, **before any code**: the problem &
outcome, market scan, tier, user stories with acceptance criteria, happy +
worst-path scenarios, an architecture sketch (entities/routes/services + where
state lives + the anti-duplication check), how the five pillars are honored, and
the open questions resolved with the operator.

These are the contract `/qa`, `/uat`, and `/manual-uat` trace their coverage
matrices against (every story × role × happy/worst). They are committed and reach
`main` (durable design intent), unlike the transient `docs/SESSION-HANDOFF.md`.

Lightweight `/quickstart` work does NOT get a file here — it does the inline
lightweight track (one clarifying-question round + a one-line design/architecture
read). See `.claude/skills/blueprint/SKILL.md`.
