import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Button } from "antd";
import { DataView } from "../../components/shared/DataView";
import { renderWithProviders, screen, cleanup } from "./_render.js";

afterEach(cleanup);

type Row = { id: number; name: string; role: string };

const columns = [
  { title: "Name", dataIndex: "name", key: "name" },
  { title: "Role", dataIndex: "role", key: "role" },
];

const rows: Row[] = [
  { id: 1, name: "Alice", role: "Admin" },
  { id: 2, name: "Bob", role: "Editor" },
];

const tick = () => new Promise((r) => setTimeout(r, 50));
const headerTexts = () =>
  Array.from(document.querySelectorAll(".ant-table-thead th")).map(
    (th) => th.textContent,
  );

test("renders a row per data item and all columns", () => {
  renderWithProviders(
    <DataView<Row> columns={columns} dataSource={rows} total={rows.length} />,
  );
  assert.ok(screen.getByText("Alice"));
  assert.ok(screen.getByText("Bob"));
  assert.ok(headerTexts().includes("Name"));
  assert.ok(headerTexts().includes("Role"));
});

test("shows the column-visibility control by default and hides it when disabled", () => {
  const { unmount } = renderWithProviders(
    <DataView<Row> columns={columns} dataSource={rows} total={rows.length} />,
  );
  assert.ok(screen.getByRole("button", { name: /Columns/ }));
  unmount();

  renderWithProviders(
    <DataView<Row>
      columns={columns}
      dataSource={rows}
      total={rows.length}
      disableColumnToggle
    />,
  );
  assert.equal(screen.queryByRole("button", { name: /Columns/ }), null);
});

test("hides a column when unchecked, but never the last one", async () => {
  renderWithProviders(
    <DataView<Row> columns={columns} dataSource={rows} total={rows.length} />,
  );
  screen.getByRole("button", { name: /Columns/ }).click();
  await tick();

  const boxes = document.querySelectorAll<HTMLElement>(
    ".ant-popover .ant-checkbox-input",
  );
  assert.equal(boxes.length, 2, "one checkbox per column");

  // Uncheck "Role" -> its header disappears.
  boxes[1].click();
  await tick();
  assert.ok(!headerTexts().includes("Role"), "Role column hidden");
  assert.ok(headerTexts().includes("Name"), "Name column still shown");

  // Unchecking the last visible column is ignored (vals.length > 0 guard).
  document
    .querySelectorAll<HTMLElement>(".ant-popover .ant-checkbox-input")[0]
    .click();
  await tick();
  assert.ok(headerTexts().includes("Name"), "last column cannot be hidden");
});

test("selection enables a bulk-action bar that Clear empties", async () => {
  renderWithProviders(
    <DataView<Row>
      columns={columns}
      dataSource={rows}
      total={rows.length}
      bulkActions={({ selectedRowKeys }) => (
        <Button>Delete ({selectedRowKeys.length})</Button>
      )}
    />,
  );

  // Row-selection checkboxes: [0] = select-all header, [1..] = rows.
  const checks = document.querySelectorAll<HTMLElement>(".ant-checkbox-input");
  assert.ok(checks.length >= 2, "selection column rendered");
  checks[1].click();
  await tick();

  assert.ok(screen.getByText("1 selected"), "ICU plural count shown");
  assert.ok(screen.getByRole("button", { name: /Delete/ }));

  screen.getByRole("button", { name: "Clear" }).click();
  await tick();
  assert.equal(screen.queryByText("1 selected"), null, "selection cleared");
});
