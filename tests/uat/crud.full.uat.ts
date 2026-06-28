import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { defaultLocale } from "./_discover";

// FULL-mode CRUD journey for THIS app (closes the deferred "CRUD journeys" gap).
//
// The bare template's generic introspective journey doesn't fit this fork: it
// drives AntD widgets (this app is shadcn/Tailwind) and the only route-discovered
// CRUD entity (role profiles) is authored through the AI wizard, whose drafting
// step needs a configured LLM (UNSET here -> "not configured"). So instead of a
// synthetic form-fill, this exercises the real, LLM-independent, admin-gated write
// loop the product actually has: the INVITATION LIFECYCLE (UI-SPEC D.5):
//
//   send single invite -> confirm it lands in the list (PENDING) -> revoke it
//   (confirm dialog) -> confirm it flips to REVOKED.
//
// Runs as ADMIN (the chromium project's default storage state). With SMTP unset
// the send outcome is "created" (link generated, email skipped) — still a real
// row + a real audit entry, which is exactly what we verify. The created invite
// lives in the LOCAL test DB only (UAT never writes production). Each phase is
// appended to uat-results/crud-journeys.json for the PDF (P3 section).

const LOCALE = defaultLocale;
const INVITES_PATH = `/${LOCALE}/app/invites`;
const JOURNEY_FILE = path.join(process.cwd(), "uat-results", "crud-journeys.json");

type PhaseStatus = "passed" | "failed" | "skipped";
type JourneyPhase = { phase: string; status: PhaseStatus; detail?: string };
type Journey = {
  entity: string;
  listPath: string;
  marker: string;
  phases: JourneyPhase[];
  consoleErrors?: string[];
  pageErrors?: string[];
};

/** Append/replace this entity's journey in the shared JSON sink (never throws). */
function recordJourney(journey: Journey): void {
  try {
    fs.mkdirSync(path.dirname(JOURNEY_FILE), { recursive: true });
    let rows: Journey[] = [];
    if (fs.existsSync(JOURNEY_FILE)) {
      try {
        rows = JSON.parse(fs.readFileSync(JOURNEY_FILE, "utf8")) as Journey[];
      } catch {
        rows = [];
      }
    }
    rows = rows.filter((r) => r.entity !== journey.entity);
    rows.push(journey);
    fs.writeFileSync(JOURNEY_FILE, JSON.stringify(rows, null, 2));
  } catch {
    // The journey file is a reporting nicety; a write failure must not fail the test.
  }
}

/** The table row that contains the given text (our created/revoked invite). */
function rowWith(page: Page, value: string) {
  return page.locator("tbody tr", { hasText: value });
}

test("CRUD journey — invitations (send → confirm → revoke)", async ({ page }, testInfo) => {
  // A full send→confirm→revoke loop is several navigations + a Sheet form + a
  // confirm dialog; give it room past the 30s default.
  test.setTimeout(120_000);

  const marker = `uat-invite-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${marker}@example.com`;
  const phases: JourneyPhase[] = [];

  const consoleErrors = new Set<string>();
  const pageErrors = new Set<string>();
  page.on("console", (msg) => {
    if (msg.type() === "error" && consoleErrors.size < 25) consoleErrors.add(msg.text());
  });
  page.on("pageerror", (err) => {
    if (pageErrors.size < 25) pageErrors.add(err.message);
  });
  // Revoke uses window.confirm — auto-accept so the journey is non-interactive.
  page.on("dialog", (d) => d.accept().catch(() => {}));

  const finish = () =>
    recordJourney({
      entity: "invitations",
      listPath: INVITES_PATH,
      marker,
      phases,
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
    });

  const shot = async (label: string) => {
    const png = await page.screenshot({ fullPage: true });
    await testInfo.attach(`invitations-${label}.png`, { body: png, contentType: "image/png" });
  };

  await page.goto(INVITES_PATH, { waitUntil: "networkidle" });
  await expect(page, "invites is admin-only; admin must reach it").not.toHaveURL(/\/login|\/app\/?$/);

  // --- SEND (single) --------------------------------------------------------
  try {
    await page.getByRole("button", { name: "Send invitations" }).click();
    const emailField = page.locator("#inv-email");
    await emailField.waitFor({ state: "visible", timeout: 10_000 });

    // No active role profile -> sending is impossible by design; skip honestly
    // rather than fail (a fork with no approved profiles is a legitimate state).
    const noRoles = await page.getByText("No active role profiles").count();
    test.skip(noRoles > 0, "no active role profiles seeded; cannot send an invite");

    await emailField.fill(email);
    await shot("send-filled");
    await page.getByRole("button", { name: "Send invitation" }).click();

    // Success resets the email field to "" (setEmail("")). That's the reliable,
    // i18n-independent signal that the POST /api/invitations succeeded.
    await expect(emailField, "email field clears on a successful send").toHaveValue("", {
      timeout: 15_000,
    });
    phases.push({ phase: "send", status: "passed" });
  } catch (e) {
    phases.push({ phase: "send", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    await shot("send-failed");
    finish();
    throw e;
  }

  // --- CONFIRM IN LIST ------------------------------------------------------
  try {
    // Close the Sheet so it doesn't overlay the table, then reload the list.
    await page.keyboard.press("Escape").catch(() => {});
    await page.goto(INVITES_PATH, { waitUntil: "networkidle" });
    const row = rowWith(page, email);
    await expect(row, "sent invite should appear in the list").toBeVisible({ timeout: 10_000 });
    // A fresh PENDING invite renders the localized status label "Sent" (not the raw
    // enum) and exposes a Revoke action (canRevoke is true until COMPLETED/REVOKED).
    // Assert the Revoke affordance rather than brittle status wording.
    await expect(
      row.getByRole("button", { name: "Revoke" }),
      "a fresh invite should be revocable",
    ).toBeVisible({ timeout: 10_000 });
    await shot("confirm-list");
    phases.push({ phase: "confirm", status: "passed" });
  } catch (e) {
    phases.push({ phase: "confirm", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    await shot("confirm-failed");
    finish();
    throw e;
  }

  // --- REVOKE ---------------------------------------------------------------
  try {
    const row = rowWith(page, email);
    await row.getByRole("button", { name: "Revoke" }).click();
    // The dialog handler accepts; the row refreshes to REVOKED and the Revoke
    // button disappears (canRevoke is false once REVOKED).
    await expect(row, "revoked invite should flip to REVOKED").toContainText(/REVOKED/i, {
      timeout: 10_000,
    });
    await shot("revoke-confirmed");
    phases.push({ phase: "revoke", status: "passed" });
  } catch (e) {
    phases.push({ phase: "revoke", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    await shot("revoke-failed");
    finish();
    throw e;
  }

  finish();

  // Uncaught runtime errors anywhere in the loop are real defects — the send
  // panel + per-row actions are exercised here, not in the main-section sweep.
  expect([...pageErrors], "invitation journey threw uncaught runtime error(s)").toHaveLength(0);
});
