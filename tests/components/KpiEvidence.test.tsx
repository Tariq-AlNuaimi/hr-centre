import { test, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { renderWithProviders, screen, cleanup, fireEvent, waitFor } from "./_render.js";
import enMessages from "../../messages/en.json" with { type: "json" };

/**
 * §7.1 — the attach-a-file flow has to be legible WITHOUT a browser console.
 *
 * The operator's report was "the file picker opens and nothing happens", on a
 * production deployment, with no way to read the console. Several things could
 * end that flow leaving nothing on screen, and the point of these tests is that
 * each one now leaves a sentence a person can act on.
 *
 * Asserted on the rendered TEXT rather than on internals: "it shows the reason"
 * is the requirement, and a test that reaches past the DOM to check state would
 * pass on a panel nobody can see.
 */

// `next/navigation`'s `useRouter` throws "invariant expected app router to be
// mounted" outside a real App Router tree, so it is stubbed rather than the
// component being contorted to avoid it. `mock.module` must be called as a
// METHOD of `mock` (it is bound to internal state via `this`), the same dance
// `tests/contracts/api-auth.test.ts` documents.
const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
let refreshes = 0;
let KpiEvidence: typeof import("../../components/pms/KpiEvidence").KpiEvidence;

before(async () => {
  assert.ok(
    typeof mockApi.module === "function",
    "component tests need --experimental-test-module-mocks (see package.json)",
  );
  mockApi.module!("next/navigation", {
    namedExports: {
      useRouter: () => ({
        refresh: () => {
          refreshes += 1;
        },
        push: () => {},
        replace: () => {},
      }),
    },
  });
  // Imported AFTER the mock is installed, or it binds the real module.
  ({ KpiEvidence } = await import("../../components/pms/KpiEvidence"));
});

afterEach(() => {
  cleanup();
});

// The real namespace, not a hand-written stand-in: these tests exist to prove
// the operator sees a real sentence, and a fixture message would prove only
// that interpolation works.
const messages = { pms: { evidence: enMessages.pms.evidence }, common: enMessages.common };

function renderPanel(overrides: Partial<Parameters<typeof KpiEvidence>[0]> = {}) {
  return renderWithProviders(
    <KpiEvidence
      kpiId="kpi-1"
      items={[]}
      canEdit
      canComment={false}
      storageConfigured
      {...overrides}
    />,
    { messages },
  );
}

/** Drop a file onto the hidden input the "Add a file" button drives. */
function choose(file: File | null) {
  const input = document.querySelector('input[type="file"]');
  assert.ok(input, "the panel must have a file input");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: file ? [file] : [],
  });
  fireEvent.change(input!);
}

const pdf = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", {
    type: "application/pdf",
  });

test("a refused upload-permission request shows the server's words AND the status", async () => {
  // The exact failure the operator could not see. A 409 here is our own
  // sentence — the deadline has passed, the cap is full, the assessment is
  // signed — and before this it reached no surface at all.
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: "The year-end deadline has passed and the stage is locked (§5.4).",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
  );

  renderPanel();
  choose(pdf());

  await waitFor(() => {
    assert.ok(screen.getByText(/Asking the server for permission to upload/));
  });
  await waitFor(() => {
    const shown = screen.getByText(/HTTP 409/);
    assert.match(shown.textContent ?? "", /deadline has passed/);
  });
});

test("an unconfigured Blob store reports itself, instead of failing mutely", async () => {
  // `BLOB_READ_WRITE_TOKEN` missing is a DEPLOYMENT state, not a user error, and
  // the preflight answers 503 with what to do about it.
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error:
            "File storage is not configured for this environment yet, so files cannot be uploaded. A link can be attached instead.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
  );

  renderPanel();
  choose(pdf());

  await waitFor(() => {
    const shown = screen.getByText(/HTTP 503/);
    assert.match(shown.textContent ?? "", /storage is not configured/);
  });
});

test("a fetch the browser never completes is blamed on CSP, by name", async () => {
  // What a Content-Security-Policy block looks like from JavaScript: a bare
  // "Failed to fetch", with the real reason only in a console the operator
  // cannot read. Guessing is not good enough, so the message says where to look.
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });

  renderPanel();
  choose(pdf());

  await waitFor(() => {
    const shown = screen.getByText(/Failed to fetch/);
    assert.match(shown.textContent ?? "", /Content-Security-Policy/);
  });
});

test("a file type off the allowlist is named, with the accepted list", async () => {
  // Refused locally, before any request — and this step used to be a toast that
  // could be missed entirely.
  renderPanel();
  choose(
    new File([new Uint8Array([1, 2, 3])], "notes.key", { type: "application/x-iwork-keynote" }),
  );

  await waitFor(() => {
    assert.ok(screen.getByText(/Checking the file type/));
    assert.ok(screen.getByText(/not accepted/));
  });
});

test("an oversize file is refused with the limit stated", async () => {
  const big = new File([new Uint8Array(8)], "huge.pdf", { type: "application/pdf" });
  // 11 MB, without allocating 11 MB.
  Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });

  renderPanel();
  choose(big);

  await waitFor(() => {
    assert.ok(screen.getByText(/10 MB/));
  });
});

test("an empty file is refused as empty, not as the wrong type", async () => {
  const empty = new File([], "blank.pdf", { type: "application/pdf" });
  renderPanel();
  choose(empty);

  await waitFor(() => {
    assert.ok(screen.getByText(/empty/i));
  });
});

test("a picker dismissed with nothing chosen says so", async () => {
  // Otherwise identical, on screen, to a broken upload — and this is the single
  // most likely thing the operator actually hit, because the accept filter used
  // to grey out valid files.
  renderPanel();
  choose(null);

  await waitFor(() => {
    assert.ok(screen.getByText(/No file came back from the picker/));
  });
});

test("the chosen file is echoed back, including a type the browser cannot name", async () => {
  // `.md` arrives with `type: ""` on most machines. Showing "nothing at all"
  // rather than a blank space is what let the type question be diagnosed.
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ error: "stop here" }), { status: 409 }),
  );

  renderPanel();
  choose(new File([new Uint8Array([0x68, 0x69])], "notes.md", { type: "" }));

  await waitFor(() => {
    const line = screen.getByText(/notes\.md/);
    assert.match(line.textContent ?? "", /nothing at all/);
  });
  // And it still resolves to a real content type off the extension.
  await waitFor(() => {
    assert.ok(screen.getByText(/text\/markdown/));
  });
});

test("the progress list is announced, so it is not only a visual change", async () => {
  renderPanel();
  choose(null);

  await waitFor(() => {
    const live = document.querySelector('[role="status"][aria-live="polite"]');
    assert.ok(live, "the progress log must be a live region");
    assert.match(live!.textContent ?? "", /No file came back/);
  });
});

test("the file input accepts dotted extensions, not only MIME types", () => {
  // The silent failure itself: with MIME types alone the OS greys out `.md` and
  // `.csv`, so nothing can be selected and no code runs to report it.
  renderPanel();
  const input = document.querySelector('input[type="file"]');
  const accept = input?.getAttribute("accept") ?? "";
  assert.match(accept, /application\/pdf/, "MIME types are still offered");
  for (const ext of [".pdf", ".md", ".csv", ".xlsx", ".png"]) {
    assert.ok(accept.includes(ext), `${ext} must be selectable by extension`);
  }
});

test("a successful save refreshes the page it is shown on", async () => {
  // The second reason evidence "didn't appear": the manager's participant page
  // is a server component that `router.refresh()` re-renders, but the
  // employee's own page reads `/api/year-end/me` through TanStack Query, which
  // `router.refresh()` does not touch. An item could be written, audited, and
  // still never show up until a manual reload — indistinguishable, from the
  // outside, from the save having failed.
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ data: { evidence: { id: "e1" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const before = refreshes;
  renderPanel();

  fireEvent.click(screen.getByRole("button", { name: /Add a link/i }));
  const [labelInput, urlInput] = screen.getAllByRole("textbox");
  fireEvent.change(labelInput, { target: { value: "Q4 summary" } });
  fireEvent.change(urlInput, { target: { value: "https://intranet.test/q4" } });
  fireEvent.click(screen.getByRole("button", { name: /Save link/i }));

  await waitFor(() => {
    assert.ok(refreshes > before, "the host page must be told to re-read");
  });
});
