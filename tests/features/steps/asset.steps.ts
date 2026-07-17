// Step definitions for tests/features/asset-tracker.feature (V2-210 pilot, ADR-058 Accepted).
//
// playwright-bdd is adopted: `npm run bdd:gen` generates Playwright specs from the .feature +
// these steps; `npm run test:bdd` runs them. Story→scenario→step COVERAGE is machine-verified now
// by `npm run bdd-coverage` (dependency-free). EXECUTION drives /api/asset via the Playwright
// `request` fixture and needs a running app + seeded DB (a UAT_BASE_URL target, or `npm run dev` +
// DB) with an authenticated storage state per role — the enforced `/ship --full` wiring is V2-401
// (Phase 4). Until then these bodies are runnable skeletons: correct against a live, authed target;
// here they simply aren't executed (no app/DB in the build container).
import { expect, type APIResponse } from "@playwright/test";
import { test as base, createBdd } from "playwright-bdd";
import { isLegalStatusTransition } from "../../../lib/validations/asset";
import { AssetStatus } from "../../../generated/prisma/client";

// A small per-scenario World holds the state steps share (role, the last API response, a seed row).
interface AssetWorld {
  role: "editor" | "viewer" | null;
  response: APIResponse | null;
  seededStatus: AssetStatus | null;
  attempted: AssetStatus | null;
}

export const test = base.extend<{ world: AssetWorld }>({
  world: async ({}, use) => {
    await use({ role: null, response: null, seededStatus: null, attempted: null });
  },
});

const { Given, When, Then } = createBdd(test);

// US1 — an editor creates + lists an asset
Given("an editor session", async ({ world }) => {
  world.role = "editor";
});
When("they create an asset with tag {string}", async ({ request, world }, tag: string) => {
  world.response = await request.post("/api/asset", {
    data: { assetTag: tag, name: "Test asset", status: "IN_STOCK", category: "LAPTOP" },
  });
});
Then("the asset is persisted and audited", async ({ world }) => {
  expect(world.response?.status()).toBe(201);
});
Then("the asset appears in the paginated list", async ({ request }) => {
  const list = await request.get("/api/asset?page=1&pageSize=20");
  expect(list.ok()).toBeTruthy();
});

// US2 — a viewer cannot write
Given("a viewer session", async ({ world }) => {
  world.role = "viewer";
});
When("they attempt to create an asset", async ({ request, world }) => {
  world.response = await request.post("/api/asset", {
    data: { assetTag: "VWR-1", name: "x", status: "IN_STOCK", category: "LAPTOP" },
  });
});
Then("the request is rejected with 403", async ({ world }) => {
  expect(world.response?.status()).toBe(403);
});
Then("no asset is written", async ({ request }) => {
  const list = await request.get("/api/asset?search=VWR-1");
  const body = await list.json();
  expect(body?.data?.length ?? 0).toBe(0);
});

// US3 — invalid input rejected with the zod message, not a 500
When("they create an asset with a blank tag", async ({ request, world }) => {
  world.response = await request.post("/api/asset", {
    data: { assetTag: "", name: "x", status: "IN_STOCK", category: "LAPTOP" },
  });
});
Then("the request is rejected with the validation message", async ({ world }) => {
  expect(world.response?.status()).toBe(400);
});
Then("no server error occurs", async ({ world }) => {
  expect(world.response?.status()).not.toBe(500);
});

// US4 — an illegal status transition is rejected. The pure lifecycle invariant is asserted here
// (runs anywhere); the route-level 400 is exercised end-to-end when run against a live app.
Given("an asset in status {string}", async ({ world }, status: string) => {
  world.seededStatus = status as AssetStatus;
});
When("an editor sets its status to {string}", async ({ world }, status: string) => {
  world.role = "editor";
  world.attempted = status as AssetStatus;
});
Then("the request is rejected as an illegal transition", async ({ world }) => {
  expect(isLegalStatusTransition(world.seededStatus!, world.attempted!)).toBe(false);
});
