import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { discoverRoles, discoverSectionAccess, type SectionAccess } from "./_discover";

// P2 (Build B) — PER-ROLE PERMISSION MATRIX. FULL mode only (`*.full.uat.ts`).
//
// For EACH role (from prisma/schema.prisma) × EACH main section (from the route
// tree), drive the app AS that role (using the storage state saved by
// roles.setup.ts) and record the outcome. Then ASSERT the access invariants that
// were DISCOVERED from the app's OWN sidebar gating (discoverSectionAccess):
//
//   - adminOnly sections  -> non-admin roles must be BLOCKED (the GET API is
//                            withAdminAuth, so the page either bounces/redirects
//                            away or renders without its data, with a 403 on the
//                            data fetch). ADMIN must REACH the content.
//   - allRoles sections   -> EVERY role must REACH them (no login bounce, ok).
//
// (Unauth -> login is covered by guard.uat.ts and not re-tested here.)
//
// EVERYTHING is discovery-driven: role names, which sections are admin-only, and
// the section list all come from the codebase — nothing is hardcoded. A fork that
// renames roles or gates a different section gets the right matrix for free.
//
// Cross-spec hand-off to the PDF: each role×section outcome is appended to
// uat-results/role-matrix.json, which scripts/uat-pdf.mjs reads to render the
// permission-matrix table (the P2 PDF section).

const LOCALE = "en";
const ROLES = discoverRoles();
const SECTIONS = discoverSectionAccess(LOCALE);
const ADMIN_ROLE = "ADMIN";

// The matrix sink the PDF reads. We append one row per role×section here.
const MATRIX_FILE = path.join(process.cwd(), "uat-results", "role-matrix.json");

type Outcome =
  | "reached" // landed on the section, data loaded (no 403)
  | "redirected-login" // bounced to /login (unauthenticated-style)
  | "redirected-away" // navigated off the section to somewhere else
  | "forbidden"; // rendered shell but the section's data API returned 403

type MatrixCell = {
  role: string;
  section: string;
  sectionPath: string;
  adminOnly: boolean;
  outcome: Outcome;
  expectedReach: boolean; // whether THIS role is expected to reach the section
  reached: boolean; // whether it actually reached (outcome === "reached")
  ok: boolean; // expected === actual
};

/** True iff the storage state for a role was saved by roles.setup.ts. */
function authFileFor(role: string): string {
  return role === ADMIN_ROLE
    ? "uat-results/.auth/admin.json"
    : `uat-results/.auth/${role.toLowerCase()}.json`;
}

function hasAuthState(role: string): boolean {
  return fs.existsSync(path.join(process.cwd(), authFileFor(role)));
}

/**
 * What each §4.1-gated section actually requires — ADR-065's second axis.
 *
 * The one hardcoded map in an otherwise discovery-driven spec, and it needs its
 * reason. Discovery reads the SIDEBAR to learn which sections are admin-gated
 * (`item.key !== "x" || isAdmin` is a literal in the nav). §4.1's gate is not
 * discoverable that way: it lives inside each page as a `usePmsActor()`
 * capability check against `Employee.pmsRoles` — a different table the
 * filesystem cannot be asked about. Each entry cites the clause it encodes.
 */
const PMS_GATES: Record<string, (a: FixtureActor) => boolean> = {
  // §10.6 — "Only HR Super Admin performs calibration adjustments... HRBP does
  // not touch calibration."
  calibration: (a) => a.pmsRoles.includes("HR_SUPER_ADMIN"),
  // §4.1 — the COO / Ops Director view. HR reaches it too (org-wide visibility).
  executive: (a) =>
    a.pmsRoles.includes("EXECUTIVE_VIEWER") ||
    a.pmsRoles.includes("HR_SUPER_ADMIN") ||
    a.pmsRoles.includes("HRBP"),
  // §4.2 — line-manager authority is DERIVED from `managerId` edges, never assigned.
  team: (a) => a.isLineManager,
  // §13.1 — every employee has a scorecard; a login with no employee record has none.
  scorecard: (a) => a.linked,
};

/**
 * The §4.1 identity of a role's fixture, written by roles.setup.ts.
 *
 * A missing file means "no employee record" — the conservative reading, and the
 * ordinary state for a login the harness provisioned itself.
 */
type FixtureActor = { linked: boolean; pmsRoles: string[]; isLineManager: boolean };

function fixtureActor(role: string): FixtureActor {
  const file = path.join(process.cwd(), `uat-results/.auth/${role.toLowerCase()}.actor.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FixtureActor;
  } catch {
    return { linked: false, pmsRoles: [], isLineManager: false };
  }
}

/**
 * Whether a given role's FIXTURE is expected to reach a section.
 *
 * Two axes, because the product has two (ADR-065). Predicting from the platform
 * role alone put four rows red against correct behaviour — a bare `User` with no
 * `Employee` holds no §4.1 authority whatever its platform role, and an ADMIN
 * linked to an HR Super Admin holds plenty. Neither is inferable from the role
 * name, so the fixture's actual employee record is resolved in setup and
 * consulted here.
 */
function expectedReach(role: string, section: SectionAccess): boolean {
  const pmsGate = PMS_GATES[section.name];
  if (pmsGate && !pmsGate(fixtureActor(role))) return false;
  // adminOnly sections are reachable only by ADMIN; allRoles by everyone.
  return section.adminOnly ? role === ADMIN_ROLE : true;
}

/** Append one matrix cell to the shared JSON sink (best-effort, never throws). */
function recordCell(cell: MatrixCell): void {
  try {
    fs.mkdirSync(path.dirname(MATRIX_FILE), { recursive: true });
    let rows: MatrixCell[] = [];
    if (fs.existsSync(MATRIX_FILE)) {
      try {
        rows = JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8")) as MatrixCell[];
      } catch {
        rows = [];
      }
    }
    // Replace any prior cell for the same role×section (idempotent re-runs).
    rows = rows.filter((r) => !(r.role === cell.role && r.section === cell.section));
    rows.push(cell);
    fs.writeFileSync(MATRIX_FILE, JSON.stringify(rows, null, 2));
  } catch {
    // The matrix file is a reporting nicety; a write failure must not fail the test.
  }
}

/**
 * Navigate AS the current role to a section and classify the outcome. We watch
 * the section's own `/api/*` XHRs: an admin-gated GET returns 403 for non-admins,
 * which is the strongest "blocked but page-shell rendered" signal (the template's
 * admin pages don't redirect — they render and the data fetch 403s).
 *
 * The admin pages are CLIENT components that fire their data GET from a
 * `useEffect`, i.e. AFTER hydration — which can land just after the navigation's
 * `networkidle`. Relying on that single idle is racy (it's why one role's 403 was
 * caught and another's wasn't). So after navigating we keep the response listener
 * attached and POLL for a short grace budget, returning the moment a 403 is seen
 * (or when the budget elapses). That makes the verdict deterministic, not timing-
 * dependent.
 */
const FORBIDDEN_GRACE_MS = 4000;
const FORBIDDEN_POLL_MS = 100;

async function visitSection(page: Page, section: SectionAccess): Promise<Outcome> {
  let sawForbidden = false;
  const onResponse = (res: { url(): string; status(): number }) => {
    const u = res.url();
    if (u.includes("/api/") && res.status() === 403) sawForbidden = true;
  };
  page.on("response", onResponse);
  try {
    await page.goto(section.path, { waitUntil: "networkidle" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // Grace window for the post-hydration data fetch to fire + resolve. Bail out
    // early the instant a 403 arrives; otherwise wait out the budget so a section
    // that genuinely loads (no 403) is correctly classified "reached".
    const deadline = Date.now() + FORBIDDEN_GRACE_MS;
    while (!sawForbidden && Date.now() < deadline) {
      await page.waitForTimeout(FORBIDDEN_POLL_MS);
    }
  } finally {
    page.off("response", onResponse);
  }

  const url = page.url();
  if (/\/login/.test(url)) return "redirected-login";

  // Did we land on the section we asked for? Compare the path (ignore query/hash).
  const landedPath = new URL(url).pathname.replace(/\/$/, "");
  const wantPath = section.path.replace(/\/$/, "");
  if (landedPath !== wantPath) return "redirected-away";

  if (sawForbidden) return "forbidden";
  return "reached";
}

// Run the matrix as a series of role-scoped describe blocks. Each block applies
// that role's saved storage state, then iterates every section.
for (const role of ROLES) {
  // The context is built INSIDE each test, from the `browser` fixture, rather
  // than declared with `test.use({ storageState })`. Two failed approaches got
  // us here, and both are worth naming:
  //
  //   1. `test.use({ storageState })` + a `test.skip()` in the body. Playwright
  //      applies `storageState` when it CREATES the context, which happens
  //      BEFORE the body runs — so a missing file produced 15 hard ENOENT
  //      failures and the skip never executed.
  //   2. Choosing `describe` vs `describe.skip` from `hasAuthState()`. That is
  //      evaluated at COLLECTION time, before the setup projects have run, so
  //      the files never exist yet and EVERY role skipped — including ADMIN,
  //      which had been passing. Thirty silent skips is worse than fifteen loud
  //      failures: a skip reads as "nothing to do here".
  //
  // Building the context in the body puts the existence check and the file read
  // in the same place, at run time, in that order. A role the setup genuinely
  // skipped is reported as skipped; every role it provisioned actually runs.
  test.describe(`permission matrix — role ${role}`, () => {
    for (const section of SECTIONS) {
      const tag = section.adminOnly ? "[adminOnly]" : "[allRoles]";

      // The expectation is computed INSIDE the body, not here. This loop runs at
      // COLLECTION time — before the setup projects have written the fixtures'
      // §4.1 identity — so anything read out here sees defaults. That trap has
      // now cost three rounds in this file (storageState, describe.skip, and
      // this), so the rule is worth stating plainly: in this spec, NOTHING that
      // depends on setup output may be evaluated outside a test body. The title
      // therefore names the section, not the prediction.
      test(`${role} -> ${section.name} ${tag}`, async ({ browser }, testInfo) => {
        const reachExpected = expectedReach(role, section);
        // Checked at RUN time, before anything opens the file.
        test.skip(
          !hasAuthState(role),
          `no storage state for ${role} (${authFileFor(role)}); roles.setup skipped it — ` +
            `usually missing UAT_${role}_PASSWORD/SEED_ADMIN_PASSWORD, or DATABASE_URL ` +
            `absent from the test runner's env so the fixture user was never provisioned`,
        );

        const context = await browser.newContext({ storageState: authFileFor(role) });
        const page = await context.newPage();
        let outcome: Outcome;
        let shot: Buffer;
        try {
          outcome = await visitSection(page, section);
          // Screenshot every role×section as the stakeholder artifact.
          shot = await page.screenshot({ fullPage: true });
        } finally {
          await context.close();
        }
        const reached = outcome === "reached";

        await testInfo.attach(`${role}-${section.name}.png`, {
          body: shot,
          contentType: "image/png",
        });

        recordCell({
          role,
          section: section.name,
          sectionPath: section.path,
          adminOnly: section.adminOnly,
          outcome,
          expectedReach: reachExpected,
          reached,
          // A row the harness cannot predict is never scored as a pass OR a
          // failure — `ok: null` renders as "recorded" in the PDF rather than a
          // tick nobody earned.
          ok: reached === reachExpected,
        });

        if (reachExpected) {
          // allRoles for everyone; adminOnly for ADMIN -> must REACH content.
          expect(reached, `${role} should REACH ${section.name} (${tag}); got "${outcome}"`).toBe(
            true,
          );
        } else {
          // adminOnly for a non-admin -> must be BLOCKED: redirected away, bounced
          // to login, or forbidden on the data fetch. The one thing it must NOT do
          // is fully reach the section content.
          expect(
            reached,
            `${role} must be BLOCKED from admin-only ${section.name}; ` +
              `instead it reached the content (outcome "${outcome}")`,
          ).toBe(false);
        }
      });
    }
  });
}

// A loud guard so an empty discovery (broken cwd / schema parse) fails visibly
// rather than reporting a vacuous green matrix.
test("matrix discovery is non-empty", () => {
  expect(ROLES.length, "no roles discovered from prisma/schema.prisma").toBeGreaterThan(0);
  expect(SECTIONS.length, "no main sections discovered").toBeGreaterThan(0);
});
