import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PageSkeleton, TableSkeleton, FormSkeleton } from "../../components/shared/Skeletons";
import { renderWithProviders, cleanup } from "./_render.js";

afterEach(cleanup);

// Skeletons were rebuilt on shadcn/Tailwind (ADR-029 C2): the silhouettes are
// pulsing `bg-muted` blocks (.animate-pulse) with data-slot hooks, no longer
// AntD `.ant-skeleton*` nodes.

test("PageSkeleton renders an animated skeleton silhouette", () => {
  const { container } = renderWithProviders(<PageSkeleton />);
  assert.ok(
    container.querySelector(".animate-pulse"),
    "renders at least one pulsing skeleton block",
  );
  // No action button by default.
  assert.equal(container.querySelector('[data-slot="skeleton-button"]'), null);
});

test("PageSkeleton can show a header action", () => {
  const { container } = renderWithProviders(<PageSkeleton withAction />);
  assert.ok(container.querySelector('[data-slot="skeleton-button"]'));
});

test("TableSkeleton always renders a header action (list screens have one)", () => {
  const { container } = renderWithProviders(<TableSkeleton />);
  assert.ok(container.querySelector('[data-slot="skeleton-button"]'));
});

test("FormSkeleton renders one input silhouette per field plus a submit", () => {
  const { container } = renderWithProviders(<FormSkeleton fields={3} />);
  assert.equal(container.querySelectorAll('[data-slot="skeleton-input"]').length, 3);
  assert.ok(container.querySelector('[data-slot="skeleton-button"]'), "submit button");
});
