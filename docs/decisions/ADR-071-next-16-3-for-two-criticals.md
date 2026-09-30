# ADR-071 — Move to Next.js 16.3.x to clear two critical CVEs

**Status:** Accepted
**Date:** 2026-09-30
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** Claude (audit triage, operator-directed)

## Context

The local QA pass on 2026-09-30 left `/ship` red on `npm audit` with seven High+ advisories, two of
them **critical**, both in `next@16.2.11`:

- **GHSA-p293-qw3h-jr36** — unauthenticated RCE, **Windows-hosted servers only**.
- **GHSA-2xp9-vwfh-vxw4** — unauthenticated RCE in the Image Optimization API when AVIF files are
  used.

`/ship` is the active gate on this fork (CI is dormant, ADR-007/ADR-017) and the pre-push hook runs
it, so nothing could be pushed while these stood — including three unrelated UI fixes that were
already green.

Two facts shaped the decision, and both had to be established rather than assumed:

1. **There is no patched release on the 16.2 line.** The vulnerable range runs through `16.3.2`, so
   `16.2.12` — the newest 16.2 — is still affected. Staying on 16.2 and patching was not an option
   that existed.
2. **A prior fork decision said to stay on 16.2.** It was recorded in `docs/agent-memory.md` and was
   about the 16.3 _preview_: the React Compiler Rust port and Turbopack's persistent production
   build cache were 16.3-only while 16.3 was `preview`/`canary`, and the note said to revisit
   **"ONLY when 16.3 ships stable"**. npm now publishes `latest = 16.3.7`, with the `preview` tag
   left behind at `16.3.0-preview.10`. The condition that decision set for itself is met.

## Decision drivers

- **A critical held open has to be re-argued on every future change.** Reachability arguments decay;
  a version bump does not.
- **No fix exists below 16.3** — so "patch without moving minor" is not on the table.
- **The pre-push gate is the real gate.** A red audit blocks unrelated work, which pushes toward
  either a bad bypass or a bad allowlist.
- **The superseded decision's own precondition is satisfied**, so honouring it means revisiting it,
  not freezing.
- **The Babel React Compiler path must survive.** ADR-048 put this fork on the stable Babel
  transform, not the 16.3-only Rust port.

## Considered options

### Option 1 — Upgrade to `next@16.3.7` (chosen)

Bump `next` `16.2.11` → `16.3.7`, move the `sharp` override `^0.35.3` → `^0.35.4`, and keep
`eslint-config-next` / `@next/bundle-analyzer` in step at `^16.3.7`.

- Good, because it removes both criticals **and** GHSA-rgj7-g3m4-5g8c (`sharp`/libheif) outright,
  rather than reasoning about their reachability.
- Good, because it is not semver-major, and 16.3 is npm `latest` rather than a preview.
- Good, because it satisfies the superseded decision on that decision's own stated terms.
- Bad, because 16.3 carries the React Compiler Rust port, so the Babel path had to be re-verified
  rather than assumed. It was: `reactCompiler: true` is still accepted with no invalid-config
  warning, `babel-plugin-react-compiler@1.0.0` still installs, the production build is green, and
  the app was re-checked in a browser against the seeded fixture.
- Bad, because 16.3 deprecates the `middleware` file convention in favour of `proxy` — a build-time
  warning, not an error. Tracked in `docs/OPEN-ITEMS.md`; deliberately not addressed here, because a
  security bump should not also carry a file-convention migration.

### Option 2 — Allowlist both criticals on reachability

Record that neither is exploitable on this deployment and keep 16.2.11.

- Good, because the reachability evidence is genuinely strong: production is Vercel/Linux (the
  Windows RCE cannot apply); the app imports `next/image` nowhere; there is no `images` config, so
  `remotePatterns` is empty and only same-origin URLs are optimizable; there is no upload feature
  and no AVIF/HEIF in `public/`.
- Bad, because `/_next/image` **is** excluded from the `middleware.ts` matcher, so the route is
  unauthenticated — the argument rests on "no attacker-controlled AVIF exists on-origin", which is a
  property of today's feature set, not a guarantee.
- Bad, because the first feature that accepts an upload silently invalidates it, and nothing in the
  gate would notice.
- Bad, because it spends the allowlist's credibility on the two entries least suited to it. The
  allowlist is for advisories with **no upstream fix**; here a fix exists.

### Option 3 — `git push --no-verify`

Bypass the pre-push gate to land the unrelated UI fixes.

- Good, because it unblocks immediately.
- Bad, because it skips gitleaks and the review-receipt gate as well as the audit — the whole
  security floor, to dodge one adjudication.
- Bad, because it leaves the criticals in place with no record that anyone decided anything.

## Decision

**Option 1.** `next@16.3.7`, `sharp` override at `^0.35.4`, tooling in step.

This **supersedes** the `docs/agent-memory.md` "Next stays 16.2.x, no 16.3 preview" decision, on that
decision's own revisit condition. It does **not** change the ADR-001 locked stack: the stack is
Next.js 16, and this moves within it.

The four remaining High+ advisories were first **allowlisted**, and that was half wrong — the
post-push breadth review caught it the same day:

- **`brace-expansion` ×2 — allowlist WITHDRAWN, upgraded instead.** The entry claimed no patched
  2.x release existed. 2.1.5/2.1.6/2.1.7 had been published two weeks earlier and the `^2.1.2`
  override already admitted them; `npm audit` was reporting `fixAvailable: true` in the same output
  used to justify the entry. The override is now `^2.1.7` and both advisories are gone. The
  "changed module export" objection that was carried over from the 2026-07-24 GHSA-mh99 entry
  applies to **5.x only**.
- **`nodemailer` ×2 — allowlisted, with a corrected reason.** The entry said "no fixed version
  exists"; 10.0.6+ does exist. `fixAvailable: false` describes the Auth.js peer chain, not the
  registry. The accurate ground is that the only fix is a **major** bump of a direct runtime
  dependency — no _non-breaking_ upstream fix, which is what the allowlist permits — deferred
  pending its own verification pass. The reachability argument is unchanged and still holds.
  Re-audit triggers: **`SMTP_HOST` being set, or the 10.x bump landing.**

Each carries a `SECURITY.md` §12 row and a §13 entry.

## Consequences

- `npm audit` is clean of both criticals and the `sharp` advisory; `/ship` is green again.
- The fork tracks 16.3.x. Future 16.3 patches are in-range for the pinned exact version only by
  deliberate bump, as before.
- The Rust React Compiler remains **unused** — ADR-048's Babel path stands, and turning it on is a
  separate decision with its own evidence.
- One follow-up is now owed: the `middleware` → `proxy` migration, before it stops being a warning.
