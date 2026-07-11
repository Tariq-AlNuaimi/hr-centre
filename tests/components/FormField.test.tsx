import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { z } from "zod";
import { useZodForm, TextField, Form } from "../../components/shared/FormField";
import { renderWithProviders, screen, cleanup, fireEvent, waitFor } from "./_render.js";

afterEach(cleanup);

// The resolver binding is the whole point of useZodForm (WS-7, ADR-046): the same
// zod schema that guards the API route drives client validation, so the two can't
// drift. These tests exercise that binding end-to-end through a mounted form —
// invalid input must surface the zod-shaped message; valid input must submit.
const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

function TestForm({ onValid }: { onValid: (values: z.infer<typeof schema>) => void }) {
  const form = useZodForm(schema, { defaultValues: { name: "" } });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValid)}>
        <TextField name="name" label="Name" />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

test("surfaces the zod validation message on an invalid submit", async () => {
  let submitted = false;
  renderWithProviders(<TestForm onValid={() => (submitted = true)} />);

  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  const message = await screen.findByRole("alert");
  assert.equal(message.textContent, "Name must be at least 2 characters");
  assert.equal(submitted, false, "onValid must not fire when the schema rejects the input");
});

test("marks the invalid control with aria-invalid", async () => {
  renderWithProviders(<TestForm onValid={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    assert.equal(screen.getByLabelText("Name").getAttribute("aria-invalid"), "true");
  });
});

test("submits the parsed values when the input satisfies the schema", async () => {
  let received: z.infer<typeof schema> | null = null;
  renderWithProviders(<TestForm onValid={(v) => (received = v)} />);

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => assert.notEqual(received, null));
  assert.deepEqual(received, { name: "Ada" });
  assert.equal(screen.queryByRole("alert"), null, "no error message on a valid submit");
});

// Cross-field .refine() with an explicit `path` is a materially different route
// through zodResolver's issue→field mapping than a flat single-field error, and
// it's the shape the real password forms use (reset-password, settings/profile).
// This guards ADR-046's actual risk — that zod v4 + resolvers v5 attach a
// path-qualified refine issue to the RIGHT field's error state, not the wrong one.
const refineSchema = z
  .object({
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"],
  });

function RefineForm({ onValid }: { onValid: (values: z.infer<typeof refineSchema>) => void }) {
  const form = useZodForm(refineSchema, {
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValid)}>
        <TextField name="newPassword" label="New password" type="password" />
        <TextField name="confirmPassword" label="Confirm password" type="password" />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

test("attaches a cross-field refine error to the field named in its path", async () => {
  let submitted = false;
  renderWithProviders(<RefineForm onValid={() => (submitted = true)} />);

  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "correcthorse" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "batterystaple" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  // The message must surface, and only the path-named field is marked invalid.
  const message = await screen.findByRole("alert");
  assert.equal(message.textContent, "Passwords must match");
  assert.equal(screen.getByLabelText("Confirm password").getAttribute("aria-invalid"), "true");
  assert.equal(
    screen.getByLabelText("New password").getAttribute("aria-invalid"),
    "false",
    "the refine error must attach to confirmPassword (its path), not newPassword",
  );
  assert.equal(submitted, false);
});
