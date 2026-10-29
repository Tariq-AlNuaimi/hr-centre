import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EmployeeLink } from "../../components/hive/escalations/EmployeeLink";
import type { Detail } from "../../components/hive/escalations/TicketActions";

afterEach(cleanup);

const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const renderWithProviders = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );

const detail = (over: Partial<Detail>) =>
  ({ employeeEmail: "a@rihal.om", identityVerified: true, employee: null, ...over }) as Detail;

test("QA2 N-14 an HR-raised ticket says 'Raised by HR', never 'Identity confirmed by Siraaj'", () => {
  renderWithProviders(<EmployeeLink detail={detail({ source: "HR" })} />);
  assert.ok(screen.getByText("Raised by HR on the employee's behalf"));
  assert.equal(screen.queryByText("Identity confirmed by Siraaj"), null);
});

test("a Siraaj ticket with a verified identity still says so", () => {
  renderWithProviders(<EmployeeLink detail={detail({ source: "SIRAAJ" })} />);
  assert.ok(screen.getByText("Identity confirmed by Siraaj"));
});
