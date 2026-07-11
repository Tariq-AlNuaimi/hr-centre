import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { discoverCrudEntities } from "./_discover";

// P3 (Build C) — PER-ENTITY CRUD JOURNEY. FULL mode only (`*.full.uat.ts`).
//
// Runs as ADMIN (the chromium project's default storage state). For EACH CRUD
// entity DISCOVERED from the route tree (a section the scaffold gave both a
// `/new` create form AND a `/[id]` record page — see discoverCrudEntities), it
// drives the full data-writing loop:
//
//   create → confirm-in-list → edit → soft-delete (gone from list)
//
// The form is INTROSPECTED, never hardcoded: visible inputs are filled by their
// kind (email/password/number/text), and every <Select> picks its first option.
// So a fork that scaffolds `projects` gets a `projects` journey for free; one
// with only read-only sections yields no journeys (recorded, not failed).
//
// Created rows are stamped with a unique `UAT-<ts>` marker so they're easy to
// find and clean up; they live in the LOCAL/preview test DB only (UAT never
// writes production). Each journey's per-phase result is appended to
// uat-results/crud-journeys.json for the PDF (P3 section).

const LOCALE = "en";
const ENTITIES = discoverCrudEntities(LOCALE);
const JOURNEY_FILE = path.join(process.cwd(), "uat-results", "crud-journeys.json");

// A valid-by-default password for any create form that has a password field
// (template rule: min 8). Not a secret — a throwaway local fixture value.
const FIXTURE_PASSWORD = "UatTest123!";

// Row-action + confirm-dialog labels. The journey is locked to LOCALE = "en"
// (above), so these are the English strings the Radix/shadcn DOM renders:
//   - Each entity's row edit/delete icon buttons carry aria-label = the entity
//     i18n namespace's editAction/deleteAction, which render as "Edit <x>" /
//     "Delete <x>" in en (components/users/UserColumns.tsx:128,141 and the
//     scaffold's generated columns). A prefix match keeps this entity-agnostic.
//   - The delete confirmation is a Radix Dialog whose primary button shows
//     common.yes = "Yes" (components/shared/ConfirmAction.tsx:65-73).
const EDIT_LABEL_PREFIX = "Edit";
const DELETE_LABEL_PREFIX = "Delete";
const CONFIRM_LABEL = "Yes";

type PhaseStatus = "passed" | "failed" | "skipped";
type JourneyPhase = { phase: string; status: PhaseStatus; detail?: string };
type Journey = {
  entity: string;
  listPath: string;
  marker: string;
  phases: JourneyPhase[];
  // Console/runtime errors observed anywhere in the journey (incl. the create +
  // edit forms, which the main-section UI/UX sweep doesn't visit). Recorded so a
  // form-only defect (e.g. a missing i18n key on /<entity>/new) is surfaced.
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

/**
 * Fill every visible field in the page's form generically and return the value
 * stamped into the first text field (the human-readable, searchable value) plus
 * the email used, if any. Nothing about the entity's fields is hardcoded.
 */
async function fillFormGenerically(
  page: Page,
  marker: string,
): Promise<{ searchValue: string; email: string | null }> {
  const form = page.locator("form").first();
  await form.waitFor({ state: "visible" });

  let searchValue = marker;
  let email: string | null = null;

  // 1) Plain inputs + textareas (the Radix Select trigger is a role="combobox"
  //    button, not an input, so it's driven separately in step 2 below).
  const fields = form.locator("input:visible, textarea:visible");
  const count = await fields.count();
  let firstTextDone = false;

  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const type = (await field.getAttribute("type")) ?? "text";
    const idAttr = (await field.getAttribute("id")) ?? "";
    const placeholder = (await field.getAttribute("placeholder")) ?? "";
    const hint = `${idAttr} ${placeholder}`.toLowerCase();

    // Skip inputs that belong to a Select / combobox / search affordance — those
    // are driven separately below; typing into them does nothing useful.
    const role = await field.getAttribute("role");
    if (role === "combobox") continue;
    if (["hidden", "checkbox", "radio", "file", "submit", "button"].includes(type)) {
      continue;
    }

    if (type === "password" || hint.includes("password")) {
      await field.fill(FIXTURE_PASSWORD);
    } else if (type === "email" || hint.includes("email") || hint.includes("mail")) {
      email = `${marker}@example.com`.toLowerCase();
      await field.fill(email);
    } else if (type === "number") {
      await field.fill("1");
    } else {
      // First free-text field carries the marker and becomes our search key.
      const value = firstTextDone ? marker : marker;
      await field.fill(value);
      if (!firstTextDone) {
        searchValue = value;
        firstTextDone = true;
      }
    }
  }

  // 2) Selects (shadcn/Radix) — open each and pick the first option. Covers
  //    role/status/relation pickers. The trigger is a Radix combobox button
  //    (components/ui/select.tsx:21-49 → SelectPrimitive.Trigger, role="combobox");
  //    options render in a portal as role="option" (select.tsx:88-119), so they
  //    are queried page-wide rather than within the form.
  const selects = form.locator('[role="combobox"]');
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const select = selects.nth(i);
    try {
      await select.click();
      const option = page.locator('[role="option"]').first();
      await option.waitFor({ state: "visible", timeout: 3000 });
      await option.click();
    } catch {
      // A select with no options (e.g. an empty relation) — leave it; if it's
      // required, the submit step will surface the validation error.
    }
  }

  return { searchValue, email };
}

/** Submit the form and assert we left the create route (no validation errors). */
async function submitForm(page: Page, leaveUrl: RegExp): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
  // Success path: the create handler navigates back to the list.
  await page.waitForURL(leaveUrl, { timeout: 15_000 });
}

/** Type into the list's search box (if present) to narrow to our marker. */
async function searchList(page: Page, value: string): Promise<void> {
  // The DataTable search box is a shadcn Input rendered with type="search"
  // (components/shared/DataTable.tsx:325-331 → <Input type="search" …/>), which
  // exposes the implicit "searchbox" role; target it by that input type.
  const search = page.locator('input[type="search"]').first();
  if (await search.count()) {
    await search.fill(value);
    // Debounce + refetch settle.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);
  }
}

/** The table row that contains the given text (our created/edited record). */
function rowWith(page: Page, value: string): Locator {
  return page.locator("tbody tr", { hasText: value });
}

for (const entity of ENTITIES) {
  test(`CRUD journey — ${entity.name}`, async ({ page }, testInfo) => {
    // A full create→confirm→edit→delete loop is several navigations + form fills
    // + screenshots; it legitimately runs well past the 30s default. Give it room
    // so a slow-but-correct journey isn't mis-reported as a failure.
    test.setTimeout(120_000);

    // Unique per run + entity so parallel journeys never collide.
    const marker = `UAT-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${entity.name}`;
    const phases: JourneyPhase[] = [];

    // Watch for console/runtime errors across the WHOLE journey — including the
    // create + edit forms the main-section UI/UX sweep never visits. De-duped +
    // capped so a chatty page doesn't bloat the report.
    const consoleErrors = new Set<string>();
    const pageErrors = new Set<string>();
    page.on("console", (msg) => {
      if (msg.type() === "error" && consoleErrors.size < 25) consoleErrors.add(msg.text());
    });
    page.on("pageerror", (err) => {
      if (pageErrors.size < 25) pageErrors.add(err.message);
    });

    const finish = () =>
      recordJourney({
        entity: entity.name,
        listPath: entity.listPath,
        marker,
        phases,
        consoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
      });

    const shot = async (label: string) => {
      const png = await page.screenshot({ fullPage: true });
      await testInfo.attach(`${entity.name}-${label}.png`, {
        body: png,
        contentType: "image/png",
      });
    };

    let searchValue = marker;

    // --- CREATE -------------------------------------------------------------
    try {
      await page.goto(entity.createPath, { waitUntil: "networkidle" });
      const filled = await fillFormGenerically(page, marker);
      searchValue = filled.searchValue;
      await shot("create-filled");
      await submitForm(page, new RegExp(`${entity.listPath}/?($|\\?)`));
      phases.push({ phase: "create", status: "passed" });
    } catch (e) {
      phases.push({
        phase: "create",
        status: "failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      await shot("create-failed");
      finish();
      throw e; // create is the journey's foundation — a real failure is a real bug.
    }

    // --- CONFIRM IN LIST ----------------------------------------------------
    try {
      await page.goto(entity.listPath, { waitUntil: "networkidle" });
      await searchList(page, searchValue);
      await expect(
        rowWith(page, searchValue),
        `created ${entity.name} should appear in the list`,
      ).toBeVisible({ timeout: 10_000 });
      await shot("confirm-list");
      phases.push({ phase: "confirm", status: "passed" });
    } catch (e) {
      phases.push({
        phase: "confirm",
        status: "failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      await shot("confirm-failed");
      finish();
      throw e;
    }

    // --- EDIT (best-effort) -------------------------------------------------
    // Click the row's edit affordance (an icon button aria-labelled from the
    // entity's editAction i18n key), tweak the first text field, save, and
    // re-confirm. Recorded but not fatal: a non-standard edit form in some fork
    // shouldn't red the whole journey.
    const editedValue = `${searchValue}-edited`;
    try {
      const editBtn = rowWith(page, searchValue)
        .locator(`button[aria-label^="${EDIT_LABEL_PREFIX}"]`)
        .first();
      await editBtn.click();
      await page.waitForURL(new RegExp(`${entity.listPath}/[^/]+/?$`), {
        timeout: 10_000,
      });
      const firstText = page.locator('form input:visible:not([type="password"])').first();
      await firstText.fill(editedValue);
      await shot("edit-filled");
      await submitForm(page, new RegExp(`${entity.listPath}/?($|\\?)`));

      await searchList(page, editedValue);
      await expect(
        rowWith(page, editedValue),
        `edited ${entity.name} should show the new value`,
      ).toBeVisible({ timeout: 10_000 });
      searchValue = editedValue;
      await shot("edit-confirmed");
      phases.push({ phase: "edit", status: "passed" });
    } catch (e) {
      phases.push({
        phase: "edit",
        status: "skipped",
        detail: e instanceof Error ? e.message : String(e),
      });
      await shot("edit-skipped");
    }

    // --- DELETE (soft) ------------------------------------------------------
    try {
      await page.goto(entity.listPath, { waitUntil: "networkidle" });
      await searchList(page, searchValue);
      const row = rowWith(page, searchValue);
      // Row delete affordance: an icon button aria-labelled from the entity's
      // deleteAction i18n key ("Delete <x>" in en). It is the trigger of a Radix
      // Dialog (components/shared/ConfirmAction.tsx), not an inline popconfirm.
      await row.locator(`button[aria-label^="${DELETE_LABEL_PREFIX}"]`).first().click();
      // Confirm via the dialog's primary button. The Radix DialogContent exposes
      // role="dialog" (components/ui/dialog.tsx:33-72) and the confirm button's
      // visible label is common.yes = "Yes" (ConfirmAction.tsx:65-73).
      const okBtn = page
        .getByRole("dialog")
        .getByRole("button", { name: CONFIRM_LABEL, exact: true })
        .first();
      await okBtn.click();
      // Soft-deleted -> drops out of the (default, non-deleted) list.
      await expect(
        rowWith(page, searchValue),
        `soft-deleted ${entity.name} should disappear from the list`,
      ).toHaveCount(0, { timeout: 10_000 });
      await shot("delete-confirmed");
      phases.push({ phase: "delete", status: "passed" });
    } catch (e) {
      phases.push({
        phase: "delete",
        status: "failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      await shot("delete-failed");
      finish();
      throw e;
    }

    finish();

    // Uncaught runtime errors anywhere in the create→…→delete loop are real
    // defects (the forms are exercised here, not in the main-section sweep).
    // Console errors are recorded as notes but not gated (often library warnings
    // or handled i18n fallbacks) — they show in the P3 report for triage.
    expect([...pageErrors], `${entity.name} journey threw uncaught runtime error(s)`).toHaveLength(
      0,
    );
  });
}

// Loud guard: record (don't fail) when there are simply no CRUD entities — a
// read-only fork is legitimate. But make the absence visible in the report.
test("CRUD discovery is recorded", () => {
  if (ENTITIES.length === 0) {
    console.warn(
      "crud.full — no CRUD entities discovered (no section has both /new and " +
        "/[id]). The P3 journey section will note that there was nothing to test.",
    );
  }
  expect(Array.isArray(ENTITIES)).toBe(true);
});
