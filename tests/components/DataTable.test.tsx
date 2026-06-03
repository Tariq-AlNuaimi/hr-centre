import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderWithProviders, screen, cleanup } from "./_render.js";
import { DataTable } from "../../components/shared/DataTable";

afterEach(cleanup);

type Row = { id: number; name: string };

const columns = [{ title: "Name", dataIndex: "name", key: "name" }];

const rows: Row[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

test("DataTable renders a row per data item", () => {
  renderWithProviders(
    <DataTable<Row> columns={columns} dataSource={rows} total={rows.length} />,
  );
  assert.ok(screen.getByText("Alice"));
  assert.ok(screen.getByText("Bob"));
});

test("DataTable shows the empty-state text when there are no rows", () => {
  renderWithProviders(<DataTable<Row> columns={columns} dataSource={[]} />);
  // locale.emptyText is t("common.noData")
  assert.ok(screen.getByText("No data found"));
});

test("DataTable hides the search input by default", () => {
  renderWithProviders(
    <DataTable<Row> columns={columns} dataSource={rows} total={rows.length} />,
  );
  assert.equal(screen.queryByPlaceholderText("Search..."), null);
});

test("DataTable shows the search input when searchable and fires onSearch", () => {
  let searched: string | null = null;
  renderWithProviders(
    <DataTable<Row>
      columns={columns}
      dataSource={rows}
      total={rows.length}
      searchable
      onSearch={(v) => {
        searched = v;
      }}
    />,
  );

  const input = screen.getByPlaceholderText("Search...") as HTMLInputElement;
  assert.ok(input);

  // Drive the controlled input the way userland would.
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, "ali");
  input.dispatchEvent(new window.Event("input", { bubbles: true }));

  assert.equal(searched, "ali");
});

test("DataTable invokes onPageChange when the pager is clicked", () => {
  let movedTo: number | null = null;
  // total > pageSize so AntD renders a second page control.
  const many: Row[] = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    name: `Person ${i + 1}`,
  }));
  renderWithProviders(
    <DataTable<Row>
      columns={columns}
      dataSource={many}
      total={50}
      page={1}
      pageSize={20}
      onPageChange={(p) => {
        movedTo = p;
      }}
    />,
  );

  // AntD pagination renders page items with title="2".
  const page2 = document.querySelector('[title="2"]');
  assert.ok(page2, "expected a page-2 control to exist");
  (page2 as HTMLElement).click();
  assert.equal(movedTo, 2);
});
