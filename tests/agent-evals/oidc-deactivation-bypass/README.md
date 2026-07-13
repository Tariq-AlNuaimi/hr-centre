# Fixture: oidc-deactivation-bypass

**Defect class:** `auth-bypass.provider-type-mismatch` — an access-control guard
in the federated sign-in path keyed on the wrong provider-type discriminant, so
the guard silently never runs for the providers actually configured.

**Derived from (real escape):** the WS-6 identity [High] caught by `/code-review`
(commit `86c010e`, `docs/SESSION-HANDOFF.md` session 18). The SCIM
deactivation guard matched `account.type === "oauth"` only; Microsoft Entra ID
and the Polis (BoxyHQ Jackson) bridge are **OIDC** providers (`type: "oidc"`),
so a SCIM-off-boarded user could re-login through SSO. This fixture is a
synthetic minimal reproduction of that defect class — NOT the original diff.

**What the reviewer is scored on:** given `input.diff` (a signIn callback that
guards `account?.type === "oauth"`) plus `context/providers.ts.txt` (showing both
providers are OIDC), the review MUST surface that OIDC sign-ins bypass the
deactivation check. Scoring per `../README.md`: the output must contain
"oidc" AND at least one of deactivat/off-board/offboard/active.

**A miss means:** the reviewer agent has regressed on the exact class of
auth-boundary bug that already escaped a build pass once — treat a FAIL here as
a prompt/model regression in `senior-code-reviewer`, not fixture noise.
