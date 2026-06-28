import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderWithProviders, screen, cleanup, fireEvent } from "./_render.js";
import DashboardError from "../../app/[locale]/(dashboard)/error";

afterEach(cleanup);

test("DashboardError renders a generic message and never leaks error.message", () => {
  renderWithProviders(
    <DashboardError error={new Error("Boom happened")} reset={() => {}} />,
  );
  assert.ok(screen.getByText("Something went wrong"));
  assert.ok(screen.getByText("An unexpected error occurred. Please try again."));
  // Security: the raw error text must NOT reach the DOM.
  assert.equal(screen.queryByText("Boom happened"), null);
});

test("DashboardError fires reset when 'Try Again' is clicked", () => {
  let reset = 0;
  renderWithProviders(
    <DashboardError
      error={new Error("Boom")}
      reset={() => {
        reset += 1;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  assert.equal(reset, 1);
});
