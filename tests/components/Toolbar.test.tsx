import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Button } from "antd";
import { Toolbar } from "../../components/shared/Toolbar";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

test("renders both the start and end slots", () => {
  renderWithProviders(
    <Toolbar
      start={<span>filters</span>}
      end={<Button type="primary">New</Button>}
    />,
  );
  assert.ok(screen.getByText("filters"));
  assert.ok(screen.getByRole("button", { name: "New" }));
});

test("omits the end slot cleanly when not given", () => {
  renderWithProviders(<Toolbar start={<span>only filters</span>} />);
  assert.ok(screen.getByText("only filters"));
  assert.equal(screen.queryByRole("button"), null);
});
