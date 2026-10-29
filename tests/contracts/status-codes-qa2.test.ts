import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

/**
 * QA2 N-17 — pages answered HTTP 200 with "403 Access denied" / "404 Page not
 * found" bodies. A `notFound()` inside a loading.tsx Suspense boundary is sent
 * after the 200 has streamed, and a redirect to /forbidden lands on a 200 page.
 */

test("N-17 a plain employee on /admin/roles gets a real 404: no loading boundary above it, no redirect", () => {
  assert.equal(existsSync("app/[locale]/(dashboard)/admin/loading.tsx"), false);
  assert.equal(existsSync("app/[locale]/(dashboard)/admin/roles/loading.tsx"), false);
  const src = readFileSync("app/[locale]/(dashboard)/admin/roles/page.tsx", "utf8");
  assert.match(src, /if \(session\.user\.role !== "ADMIN"\) notFound\(\);/);
  // The other admin screens keep their skeleton, one level down — except the
  // settings hub, whose sub-pages answer 404 themselves (ADR-101).
  assert.equal(existsSync("app/[locale]/(dashboard)/admin/cycles/(list)/loading.tsx"), true);
  assert.equal(existsSync("app/[locale]/(dashboard)/admin/settings/loading.tsx"), false);
});

test("N-17 /tickets is gated OUTSIDE its loading boundary", () => {
  const src = readFileSync("app/[locale]/(dashboard)/tickets/layout.tsx", "utf8");
  assert.match(src, /notFound\(\)/);
  assert.match(src, /getHivePermissions/);
});

test("N-17 an invalid careers-status or preboarding token is a 404 with the same friendly page", () => {
  for (const dir of [
    "app/[locale]/(careers)/careers/status/[token]",
    "app/[locale]/(joiner)/preboarding/[token]",
  ]) {
    assert.ok(existsSync(`${dir}/not-found.tsx`), dir);
    assert.match(readFileSync(`${dir}/page.tsx`, "utf8"), /notFound\(\)/, dir);
  }
});
