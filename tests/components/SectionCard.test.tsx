import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Button } from "antd";
import { SectionCard } from "../../components/shared/SectionCard";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

test("renders the title at heading level 3 by default", () => {
  renderWithProviders(
    <SectionCard title="Recent activity">content</SectionCard>,
  );
  // Default h3 keeps a gap-free outline under a PageHeader (h2) — WCAG 2.4.6.
  assert.equal(
    screen.getByRole("heading", { name: "Recent activity" }).tagName,
    "H3",
  );
});

test("honors an explicit headingLevel", () => {
  renderWithProviders(
    <SectionCard title="Sub-section" headingLevel={4}>
      content
    </SectionCard>,
  );
  assert.equal(screen.getByRole("heading", { name: "Sub-section" }).tagName, "H4");
});

test("renders subtitle, actions, and children", () => {
  renderWithProviders(
    <SectionCard
      title="Users"
      subtitle="Manage your team"
      actions={<Button type="primary">New</Button>}
    >
      <p>body content</p>
    </SectionCard>,
  );
  assert.ok(screen.getByText("Manage your team"));
  assert.ok(screen.getByRole("button", { name: "New" }));
  assert.ok(screen.getByText("body content"));
});
