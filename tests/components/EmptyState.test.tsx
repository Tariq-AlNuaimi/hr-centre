import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderWithProviders, screen, cleanup, fireEvent } from "./_render.js";
import { EmptyState } from "../../components/shared/EmptyState";

afterEach(cleanup);

test("EmptyState renders the provided description", () => {
  renderWithProviders(<EmptyState description="Nothing here yet" />);
  assert.ok(screen.getByText("Nothing here yet"));
});

test("EmptyState falls back to the common.noData translation", () => {
  renderWithProviders(<EmptyState />);
  assert.ok(screen.getByText("No data found"));
});

test("EmptyState renders the action button and fires onAction", () => {
  let clicked = 0;
  renderWithProviders(
    <EmptyState
      description="Empty"
      actionLabel="Create one"
      onAction={() => {
        clicked += 1;
      }}
    />,
  );

  const button = screen.getByRole("button", { name: "Create one" });
  fireEvent.click(button);
  assert.equal(clicked, 1);
});

test("EmptyState omits the action button when no handler is given", () => {
  renderWithProviders(<EmptyState description="Empty" actionLabel="Create one" />);
  assert.equal(screen.queryByRole("button", { name: "Create one" }), null);
});
