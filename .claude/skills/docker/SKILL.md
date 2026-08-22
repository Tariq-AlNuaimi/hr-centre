---
name: docker
description: Containerize the CURRENT app for self-hosting -- build a small standalone image, run it against a Postgres/Neon URL, or bring up the full local app+DB stack. Wraps the opt-in Docker self-host rail (ADR-023). Use when the user says "dockerize this", "/docker", "containerize the app", "build a docker image", "run it in docker", "self-host this", "hand IT a runnable image".
---

# /docker — Containerize the app (opt-in self-host rail)

Production stays Vercel + Neon by default (ADR-006). This skill is the **opt-in
self-host rail** (ADR-023) for forks that need to run on-prem, air-gapped, in
k8s, or that hand the IT team a runnable image at `/handoff`. It does **not**
replace `/deploy` — for a live URL, use `/deploy` (Vercel) first.

Everything here wraps existing, committed infrastructure — there is nothing to
install:

- `Dockerfile` — multi-stage build → small standalone runtime image
- `docker-compose.dev.yml` — full local stack (app + Postgres)
- `Makefile` targets — `docker-build` / `docker-run` / `docker-up` / `docker-down`
- `next.config.ts` — emits `output: "standalone"` **only** when `DOCKER_BUILD=1`
  (so the Vercel build is unchanged; don't make standalone unconditional — ADR-023)

## When to use which target

| Goal                              | Command             | Notes                                                                                |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Build a deployable image          | `make docker-build` | Tag override: `make docker-build IMAGE=myrepo/app:1.2.3`                             |
| Run the built image               | `make docker-run`   | Runs against the `DATABASE_URL` in `.env`; secrets passed at runtime, never baked in |
| Full local stack (app + Postgres) | `make docker-up`    | Builds + starts via `docker-compose.dev.yml`                                         |
| Tear the stack down               | `make docker-down`  |                                                                                      |

## Procedure

1. **Confirm intent + scope.** Self-hosting is the exception, not the default.
   Ask the operator what they actually want:
   - A **shippable image** to hand IT / push to a registry → build path.
   - A **local containerized run** to reproduce prod-like behavior → compose path.
     If they really just want a shareable URL, redirect to `/deploy` — don't
     containerize for that.

2. **Preflight.** Confirm Docker is available (`docker version`). If the daemon
   isn't running or `docker` isn't on PATH in this environment, say so plainly
   (don't claim a build succeeded) and stop — this is an environment limit, not a
   code problem.

3. **Never bake secrets.** Confirm `.env` is NOT in the image — `.dockerignore`
   excludes it and `make docker-run` passes `--env-file .env` at runtime. Restricted
   env vars (auth/DB/SMTP — SECURITY.md §1) are injected at run time only. If the
   operator pushes the image to a registry, remind them the image is safe to push
   (no secrets) but `.env` is not.

4. **Build / run.** Run the matching `make docker-*` target. For a registry push,
   build with an explicit `IMAGE=<registry>/<repo>:<tag>` and let the operator run
   the `docker push` (don't push to a registry on their behalf without asking).

5. **Verify it actually runs.** After `docker-up` / `docker-run`, confirm the app
   answers on `http://localhost:3000` (curl or browser) and that migrations applied
   (the container runs `prisma migrate deploy`). A container that starts but 500s on
   the first request is a finding, not a success — report it honestly.

6. **Hand-off note.** When this is for `/handoff`, record in HANDOFF.md: the image
   tag, the required runtime env vars (DATABASE_URL + the auth/SMTP set), and the
   `make docker-run` / `docker run` invocation. The IT team needs to reproduce the
   run, not reverse-engineer it.

## Guardrails (ADR-023)

- **Don't re-enable `output: "standalone"` unconditionally** in `next.config.ts`.
  It is gated on `DOCKER_BUILD=1` so the Vercel build stays unchanged; making it
  unconditional does nothing for Vercel and risks the build path. (Ask-before file.)
- **Vercel + Neon stays the default.** This rail is additive. Don't propose Docker
  as the primary deploy path unless the operator's requirement is genuinely
  self-host (on-prem / air-gapped / k8s).
- Keep the image lean: the build is multi-stage and traces only the standalone
  runtime; don't add dev dependencies or build tooling to the runtime stage.

## Verification

Before calling this done:

- [ ] `docker version` confirmed available (or the environment limit was
      reported plainly and the run stopped, rather than claiming success)
- [ ] `.env` confirmed absent from the built image — secrets passed only via
      `--env-file` / runtime env vars, never baked in
- [ ] the matching `make docker-*` target completed (build/run/up/down)
- [ ] the running container answers on `http://localhost:3000` and
      `prisma migrate deploy` applied cleanly on startup
- [ ] for a `/handoff` use, HANDOFF.md records the image tag, required
      runtime env vars, and the `make docker-run` / `docker run` invocation

**Emits:** a built image / running container.

## Related

- `/deploy` — the default live-URL path (Vercel + Neon). Prefer this for sharing.
- `/scale-up` — the self-host rail is listed there as a growth option.
- `/handoff` — wrap the image + run instructions into the IT handoff package.
- ADR-006 (Vercel + Neon default) · ADR-023 (this rail).
