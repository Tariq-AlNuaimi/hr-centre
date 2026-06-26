import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DescriptionList } from "../../components/shared/DescriptionList";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

const items = [
  { key: "name", label: "Name", value: "Sara Al-Hinai" },
  { key: "role", label: "Role", value: "Admin" },
];

test("renders each item's label and value", () => {
  renderWithProviders(<DescriptionList items={items} />);
  assert.ok(screen.getByText("Name"));
  assert.ok(screen.getByText("Sara Al-Hinai"));
  assert.ok(screen.getByText("Role"));
  assert.ok(screen.getByText("Admin"));
});

test("renders a title when provided", () => {
  renderWithProviders(<DescriptionList items={items} title="Profile" />);
  assert.ok(screen.getByText("Profile"));
});

test("renders cleanly with no items", () => {
  const { container } = renderWithProviders(<DescriptionList items={[]} />);
  assert.ok(container.querySelector(".ant-descriptions"));
});
