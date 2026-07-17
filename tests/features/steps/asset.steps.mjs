// Step definitions for tests/features/asset-tracker.feature (V2-210 pilot, ADR-058).
//
// playwright-bdd is ADOPTED (ADR-058) but its install + real execution is DEFERRED to the
// enforced `/ship --full` gate (V2-401, Phase 4) pending operator sign-off. Until then these
// register the step TEXTS so `npm run bdd-coverage` can machine-verify story↔scenario↔step
// coverage (every US1–US4 has a scenario; every step has a definition). The bodies are
// documented placeholders — NOT executed yet.
//
// WHEN playwright-bdd lands, replace the shim below with:
//   import { createBdd } from "playwright-bdd";
//   const { Given, When, Then } = createBdd();
// and fill each body to drive /api/asset via the Playwright request fixture, asserting the
// blueprint AC (403 for a viewer, the zod message on blank tag, the illegal-transition reject).

// -- local no-op shim (removed when playwright-bdd is installed) --
const step = () => {};
const Given = (_pattern, _fn) => {};
const When = (_pattern, _fn) => {};
const Then = (_pattern, _fn) => {};

// US1 — create + list
Given("an editor session", step);
When("they create an asset with tag {string}", step);
Then("the asset is persisted and audited", step);
Then("the asset appears in the paginated list", step);

// US2 — RBAC (viewer rejected)
Given("a viewer session", step);
When("they attempt to create an asset", step);
Then("the request is rejected with 403", step);
Then("no asset is written", step);

// US3 — validation (blank tag → zod message, not a 500)
When("they create an asset with a blank tag", step);
Then("the request is rejected with the validation message", step);
Then("no server error occurs", step);

// US4 — illegal status transition rejected (isLegalStatusTransition guard)
Given("an asset in status {string}", step);
When("an editor sets its status to {string}", step);
Then("the request is rejected as an illegal transition", step);
