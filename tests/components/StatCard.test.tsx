import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { UserOutlined } from "@ant-design/icons";
import { StatCard } from "../../components/shared/StatCard";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

test("renders the title, value, and hint", () => {
  renderWithProviders(
    <StatCard title="Total users" value="128" hint="vs. last month" />,
  );
  assert.ok(screen.getByText("Total users"));
  assert.ok(screen.getByText("128"));
  assert.ok(screen.getByText("vs. last month"));
});

test("renders a leading icon when given", () => {
  const { container } = renderWithProviders(
    <StatCard title="Users" value="1" icon={<UserOutlined />} />,
  );
  assert.ok(container.querySelector(".anticon"), "icon chip renders");
});

test("trend pill exposes direction to assistive tech via aria-label", () => {
  renderWithProviders(
    <StatCard title="Signups" value="9" trend={{ value: 12, direction: "up" }} />,
  );
  // Direction is conveyed by text, not color+icon alone (WCAG 1.1.1 / 1.3.3).
  assert.ok(screen.getByLabelText("Up 12%"));
});

test("trend color reflects good/bad, not raw direction", () => {
  // up = good (default), down-when-down-is-good = good, down (default) = bad.
  renderWithProviders(
    <StatCard title="A" value="1" trend={{ value: 10, direction: "up" }} />,
  );
  renderWithProviders(
    <StatCard
      title="B"
      value="2"
      trend={{ value: 4, direction: "down", positiveIsGood: false }}
    />,
  );
  renderWithProviders(
    <StatCard title="C" value="3" trend={{ value: 7, direction: "down" }} />,
  );

  const goodUp = (screen.getByLabelText("Up 10%") as HTMLElement).style.color;
  const goodDown = (screen.getByLabelText("Down 4%") as HTMLElement).style.color;
  const bad = (screen.getByLabelText("Down 7%") as HTMLElement).style.color;

  assert.ok(goodUp, "trend color is set inline");
  assert.equal(goodUp, goodDown, "down-is-good uses the same success color as up-is-good");
  assert.notEqual(goodUp, bad, "a bad trend uses a different (error) color");
});

test("omits the trend pill cleanly when no trend is given", () => {
  renderWithProviders(<StatCard title="Quiet" value="0" />);
  assert.equal(screen.queryByLabelText(/^(Up|Down)/), null);
});
