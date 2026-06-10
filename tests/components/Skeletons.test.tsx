import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PageSkeleton,
  TableSkeleton,
  FormSkeleton,
} from "../../components/shared/Skeletons";
import { renderWithProviders, cleanup } from "./_render.js";

afterEach(cleanup);

test("PageSkeleton renders an animated skeleton silhouette", () => {
  const { container } = renderWithProviders(<PageSkeleton />);
  assert.ok(
    container.querySelector(".ant-skeleton"),
    "renders at least one skeleton block",
  );
  // No action button by default.
  assert.equal(container.querySelector(".ant-skeleton-button"), null);
});

test("PageSkeleton can show a header action", () => {
  const { container } = renderWithProviders(<PageSkeleton withAction />);
  assert.ok(container.querySelector(".ant-skeleton-button"));
});

test("TableSkeleton always renders a header action (list screens have one)", () => {
  const { container } = renderWithProviders(<TableSkeleton />);
  assert.ok(container.querySelector(".ant-skeleton-button"));
});

test("FormSkeleton renders one input silhouette per field plus a submit", () => {
  const { container } = renderWithProviders(<FormSkeleton fields={3} />);
  // 3 field inputs + 1 header input = 4 input skeletons.
  assert.equal(container.querySelectorAll(".ant-skeleton-input").length, 4);
  assert.ok(container.querySelector(".ant-skeleton-button"), "submit button");
});
