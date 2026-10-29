import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import "../../lib/validations/messages";

/** QA D-15 — readable validation messages (lib/validations/messages.ts). */

const schema = z.object({
  email: z.email(),
  password: z.string().min(8),
  reference: z.string().trim().min(1).max(5),
  kind: z.enum(["A", "B"]),
  days: z.number().int().min(0),
  named: z.string().min(3, "Custom wins."),
});

function messages(input: unknown): Record<string, string> {
  const r = schema.safeParse(input);
  assert.equal(r.success, false);
  return Object.fromEntries(r.error!.issues.map((i) => [i.path.join("."), i.message]));
}

test("D-15: no zod type-checker text reaches a person", () => {
  const m = messages({ email: "x", password: "a", reference: "", kind: "C", days: -1, named: "a" });
  assert.equal(m.email, "Enter a valid email address.");
  assert.equal(m.password, "Enter at least 8 characters.");
  assert.equal(m.reference, "This field is required.");
  assert.equal(m.kind, "Choose one of the allowed options.");
  assert.equal(m.days, "Enter 0 or more.");
  for (const text of Object.values(m)) {
    assert.doesNotMatch(text, /expected|Too small|Too big|Invalid input/);
  }
});

test("D-15: a schema's own message still wins", () => {
  assert.equal(messages({ named: "a" }).named, "Custom wins.");
});

test("D-15: missing fields read as required; long ones name the limit", () => {
  const m = messages({ reference: "123456" });
  assert.equal(m.email, "This field is required.");
  assert.equal(m.reference, "Keep this to 5 characters or fewer.");
});

test("D-15: the API and every form install the messages", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/api-response.ts", "components/shared/FormField.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /import "@\/lib\/validations\/messages";/, f);
  }
});

test("D-17: a department name repeated across companies carries the company", async () => {
  const { unitOptions } = await import("../../components/org/unit-options");
  const names: Record<string, string> = { r: "Rihal", c: "Codeline" };
  const options = unitOptions(
    [
      { id: "1", name: "Sales", entityId: "r" },
      { id: "2", name: "Sales", entityId: "c" },
      { id: "3", name: "Finance", entityId: "r" },
    ],
    (id) => names[id],
  );
  assert.deepEqual(
    options.map((o) => o.label),
    ["Sales · Rihal", "Sales · Codeline", "Finance"],
  );
});

test("D-16: no route-level loading boundary sits above people/[id]", async () => {
  const { existsSync } = await import("node:fs");
  // A boundary at or above the person page streams it, and its out-of-scope
  // notFound() then answers HTTP 200 instead of 404.
  assert.equal(existsSync("app/[locale]/(dashboard)/loading.tsx"), false);
  assert.equal(existsSync("app/[locale]/(dashboard)/people/loading.tsx"), false);
  assert.equal(existsSync("app/[locale]/(dashboard)/people/[id]/loading.tsx"), false);
  assert.equal(existsSync("app/[locale]/(dashboard)/people/(list)/loading.tsx"), true);
});
