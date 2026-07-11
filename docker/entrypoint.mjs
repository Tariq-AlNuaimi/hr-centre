// Distroless container entrypoint (ADR-035 — Docker-first self-host rail).
//
// The runtime image is `gcr.io/distroless/nodejs24-debian12:nonroot`, which has
// NO shell and NO `npx`. The old `CMD ["sh","-c","prisma migrate deploy && node
// server.js"]` therefore cannot run. This Node script is the replacement: the
// distroless ENTRYPOINT is already `node`, so `CMD ["docker/entrypoint.mjs"]`
// runs as `node docker/entrypoint.mjs` with CWD = /app (the standalone app root).
//
// It (a) applies pending migrations, then (b) hands off to the Next standalone
// server in-process. Paths are resolved against the app root, not this module's
// own directory (this file lives at /app/docker/, the server + node_modules at
// /app/), so it stays correct regardless of CWD.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// /app — this module is at /app/docker/entrypoint.mjs, so ".." is the app root.
const appRoot = fileURLToPath(new URL("..", import.meta.url));

// (a) Forward-only migrations before serving traffic. Distroless ships no shell
// and no `npx`, so spawn the Prisma CLI's entry module on the current Node
// binary (`process.execPath`). `migrate deploy` applies committed migrations
// only — it never generates, resets, or drops — so it is safe on every start.
// DATABASE_URL (and any auth/SMTP secrets) come from the runtime env, never the
// image. Migrations must stay forward-compatible (CLAUDE.md / ADR-035): never
// drop a column the running version still reads.
const prismaCli = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);

const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  stdio: "inherit",
  cwd: appRoot,
});

if (migrate.error) {
  console.error(
    `[entrypoint] failed to spawn prisma migrate deploy: ${migrate.error.message}`,
  );
  process.exit(1);
}
if (migrate.status !== 0) {
  const reason =
    migrate.status !== null
      ? `exit ${migrate.status}`
      : `signal ${migrate.signal}`;
  console.error(
    `[entrypoint] prisma migrate deploy failed (${reason}); refusing to start the server`,
  );
  process.exit(migrate.status ?? 1);
}

// (b) Boot the Next.js standalone server in this same process. Importing
// server.js runs its top-level listen (it reads PORT/HOSTNAME from the env set
// in the Dockerfile). Resolve it against the app root so the import is correct
// even though this file sits one directory deeper.
await import(new URL("../server.js", import.meta.url).href);
