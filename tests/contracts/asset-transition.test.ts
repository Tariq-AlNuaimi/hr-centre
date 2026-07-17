// Contract test for the Asset status-lifecycle invariant (V2-210 pilot, ADR-059).
// The bespoke rule the schema alone can't state: legal status moves are
// IN_STOCK↔ASSIGNED, IN_STOCK→REPAIR→IN_STOCK, any→RETIRED (terminal); a same-status
// no-op is always legal; RETIRED has no outgoing move. The PUT /api/asset/[id] route
// enforces this (US4-worst → illegal transition rejected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLegalStatusTransition } from "../../lib/validations/asset";
import { AssetStatus } from "../../generated/prisma/client";

const { IN_STOCK, ASSIGNED, REPAIR, RETIRED } = AssetStatus;

test("legal transitions are allowed", () => {
  assert.equal(isLegalStatusTransition(IN_STOCK, ASSIGNED), true);
  assert.equal(isLegalStatusTransition(ASSIGNED, IN_STOCK), true);
  assert.equal(isLegalStatusTransition(IN_STOCK, REPAIR), true);
  assert.equal(isLegalStatusTransition(REPAIR, IN_STOCK), true);
  assert.equal(isLegalStatusTransition(ASSIGNED, RETIRED), true);
  assert.equal(isLegalStatusTransition(IN_STOCK, RETIRED), true);
});

test("a same-status no-op is always legal", () => {
  for (const s of [IN_STOCK, ASSIGNED, REPAIR, RETIRED])
    assert.equal(isLegalStatusTransition(s, s), true, `${s}→${s}`);
});

test("RETIRED is terminal — no outgoing transition", () => {
  assert.equal(isLegalStatusTransition(RETIRED, ASSIGNED), false, "the US4-worst case");
  assert.equal(isLegalStatusTransition(RETIRED, IN_STOCK), false);
  assert.equal(isLegalStatusTransition(RETIRED, REPAIR), false);
});

test("REPAIR cannot jump straight to ASSIGNED (must return to stock first)", () => {
  assert.equal(isLegalStatusTransition(REPAIR, ASSIGNED), false);
});
