import { test } from "node:test";
import assert from "node:assert/strict";
import { isAccountLocked, recordFailedLogin, clearFailedLogins } from "../../lib/account-lockout";

// Exercises the in-memory backend (the default; no VALKEY_URL in the test env). The
// Valkey path is the same rate-limiter-flexible API with a shared store, so the
// semantics asserted here hold on both. Defaults: 5 fails / 900s window / 900s lock.
//
// Each test uses a unique email so cases can't bleed into one another (the limiter is
// module-level state, exactly as it is in production).
const uniq = (p: string) => `${p}-${Math.random().toString(36).slice(2)}@example.com`;

test("a fresh account is not locked", async () => {
  assert.equal(await isAccountLocked(uniq("fresh")), false);
});

test("failures below the threshold do NOT lock the account", async () => {
  const email = uniq("under");
  for (let i = 0; i < 4; i++) {
    const tripped = await recordFailedLogin(email);
    assert.equal(tripped, false, `failure ${i + 1} must not trip the lock`);
  }
  assert.equal(await isAccountLocked(email), false);
});

test("the Nth failure trips the lock and isAccountLocked then reports true", async () => {
  const email = uniq("trip");
  for (let i = 0; i < 4; i++) await recordFailedLogin(email);
  // The 5th consumes the last point; the 6th is rejected -> locked.
  await recordFailedLogin(email);
  const tripped = await recordFailedLogin(email);
  assert.equal(tripped, true, "the failure past the threshold must report the lock");
  assert.equal(await isAccountLocked(email), true);
});

test("a successful login clears the counter", async () => {
  const email = uniq("clear");
  for (let i = 0; i < 3; i++) await recordFailedLogin(email);
  await clearFailedLogins(email);
  assert.equal(await isAccountLocked(email), false);
  // ...and the budget is genuinely reset, not merely unlocked.
  for (let i = 0; i < 4; i++) {
    assert.equal(await recordFailedLogin(email), false);
  }
});

test("the counter is case- and whitespace-insensitive (no trivial bypass)", async () => {
  const base = uniq("case");
  const upper = `  ${base.toUpperCase()}  `;
  for (let i = 0; i < 5; i++) await recordFailedLogin(base);
  await recordFailedLogin(base);
  // Same identity, different casing/padding -> must observe the SAME lock.
  assert.equal(
    await isAccountLocked(upper),
    true,
    "casing/whitespace must not create a second bucket",
  );
});

test("lockout state is per-account, not global", async () => {
  const victim = uniq("victim");
  const bystander = uniq("bystander");
  for (let i = 0; i < 6; i++) await recordFailedLogin(victim);
  assert.equal(await isAccountLocked(victim), true);
  assert.equal(
    await isAccountLocked(bystander),
    false,
    "one locked account must not lock everyone else out",
  );
});

test("a non-existent account is counted too (no user enumeration signal)", async () => {
  // authorize() calls recordFailedLogin for a miss AND for a bad password, so the
  // observable behaviour is identical. This asserts the counting side of that: an
  // email with no account still accrues + locks like any other.
  const ghost = uniq("ghost");
  for (let i = 0; i < 5; i++) await recordFailedLogin(ghost);
  assert.equal(await recordFailedLogin(ghost), true);
  assert.equal(await isAccountLocked(ghost), true);
});
