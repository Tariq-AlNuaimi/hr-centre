import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/shared/PageHeader";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

test("renders the title as a heading at the requested level", () => {
  renderWithProviders(<PageHeader title="Users" />);
  const heading = screen.getByRole("heading", { name: "Users" });
  assert.equal(heading.tagName, "H2", "default level is 2");
});

test("honors an explicit heading level", () => {
  renderWithProviders(<PageHeader title="Profile" level={3} />);
  assert.equal(screen.getByRole("heading", { name: "Profile" }).tagName, "H3");
});

test("renders a subtitle when provided", () => {
  renderWithProviders(<PageHeader title="Users" subtitle="Manage your team" />);
  assert.ok(screen.getByText("Manage your team"));
});

test("renders the primary action in the actions slot", () => {
  renderWithProviders(
    <PageHeader
      title="Users"
      actions={<Button>New user</Button>}
    />,
  );
  assert.ok(screen.getByRole("button", { name: "New user" }));
});

test("omits the actions slot cleanly when no action is given", () => {
  renderWithProviders(<PageHeader title="Settings" />);
  assert.equal(screen.queryByRole("button"), null);
});
