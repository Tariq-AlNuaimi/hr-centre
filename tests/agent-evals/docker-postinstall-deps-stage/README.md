# Fixture: docker-postinstall-deps-stage

**Defect class:** `build-break.lifecycle-script-missing-context` — an npm
lifecycle script (`postinstall`) that assumes the full source tree, added to a
repo whose Docker `deps` stage runs `npm ci` with only `package.json` + the
lockfile in context. The script exits non-zero there and every image build
fails, even though the Vercel/`next build` path (full checkout, install after
clone) stays green — the classic "verified on one build rail, broke the other".

**Derived from (real escape):** the item-3 docs-site enabler [Critical] caught
by the senior breadth review (`docs/blueprints/docs-site-fumadocs.md`, "Docker
path" section): a bare `postinstall: fumadocs-mdx` bricked the ADR-030 Docker
gate for any enabled fork; the fix was a `node -e` guard that no-ops when
`source.config.ts` is absent. This fixture is a synthetic minimal reproduction
of the defect class — NOT the original diff.

**What the reviewer is scored on:** given `input.diff` (adds
`"postinstall": "docs-mdx-codegen"` + a `source.config.ts`) plus
`context/Dockerfile` (deps stage copies only package.json+lock before `npm ci`),
the review MUST surface that the unguarded postinstall breaks the Docker image
build. Scoring per `../README.md`: the output must contain "postinstall" AND a
docker/deps-stage/image term AND an npm-ci/install/lockfile term.

**A miss means:** the reviewer agent has regressed on cross-rail build
verification — the exact operational-drift class the post-push breadth pass
exists to own. Treat a FAIL as a prompt/model regression, not fixture noise.
