import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { routeDecision, isPublicPath, isEmployeePath } from "../../i18n/route-decision";

// ADR-075 retired HIVE's anonymous employee chat; employees ask Siraaj. What
// stays reachable without a HIVE session is (a) ADR-070's reply link and (b) the
// MCP server Siraaj calls, gated by its own bearer token. ADR-068's property
// still holds for what is left: "the public surface stays a short, auditable
// list rather than a pattern: adding a sixth route is another deliberate act,
// not a config that has already been loosened."
//
// That property is enforced by TWO independent files agreeing --
// `i18n/route-decision.ts` (middleware's 401 backstop) and
// `eslint-rules/rules/no-bare-api-route.mjs` (the build-time wrapper rule). Two
// lists that must agree are two lists that can silently diverge, and the
// dangerous direction is asymmetric: a route public in the ESLint allowlist but
// not in route-decision is merely broken, while the reverse ships an
// unauthenticated handler the build no longer objects to.
//
// So this file asserts the two agree, and that they agree with what is actually
// on disk.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const API_DIR = join(ROOT, "app", "api");

/**
 * Routes with NO auth wrapper at all — since ADR-075, only ADR-070's reply link.
 * Its wrapper is replaced by a signed, expiring, revocable bearer token that
 * grants exactly one escalation thread. Adding a route here takes three
 * decisions: this list, the ESLint allowlist and `route-decision.ts`.
 */
const EXPECTED_PUBLIC_ROUTES = [
  "api/hive/reply/[token]/route.ts",
  // Hiring (ADR-080): the careers board, its apply path, and the agency invite link.
  "api/careers/route.ts",
  "api/careers/apply/route.ts",
  "api/agency/[token]/submit/route.ts",
  // JML preboarding (ADR-093): the joiner's form and picture, token-authorised.
  "api/preboarding/[token]/route.ts",
  "api/preboarding/[token]/photo/route.ts",
];

const AUTH_WRAPPERS = [
  "withAuth",
  "withAdminAuth",
  "withEditorAuth",
  "withInternalAuth",
  "withApiAuth",
];

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkRoutes(full, out);
    else if (/^route\.(?:[cm]?js|jsx|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const routeFiles = walkRoutes(API_DIR);

/** Route files that export a handler with no auth wrapper anywhere in them. */
const bareRoutes = routeFiles.filter((file) => {
  const src = readFileSync(file, "utf8");
  return !AUTH_WRAPPERS.some((w) => src.includes(`${w}(`));
});

const rel = (file: string) => relative(join(ROOT, "app"), file).split(sep).join("/");

describe("ADR-075 -- the public surface is exactly what was signed off", () => {
  test("no route is unauthenticated except the reply link", () => {
    const bare = bareRoutes.map(rel).sort();
    const expected = [...EXPECTED_PUBLIC_ROUTES, "api/health/route.ts"].sort();
    // Auth.js's own handler lives under app/api/auth and is allowed to be bare;
    // it may or may not name a wrapper, so it is filtered rather than asserted.
    const withoutAuthJs = bare.filter((f) => !f.startsWith("api/auth/"));
    assert.deepEqual(
      withoutAuthJs,
      expected,
      "A new unauthenticated route appeared. If that is deliberate it needs an ADR " +
        "amendment, an entry in BOTH allowlists, and a line here.",
    );
  });

  test("every enumerated public route is passed through by middleware", () => {
    for (const file of EXPECTED_PUBLIC_ROUTES) {
      const path = "/" + file.replace(/\/route\.tsx?$/, "");
      assert.deepEqual(
        routeDecision(path, false),
        { kind: "pass" },
        `${path} must reach its handler without a session`,
      );
    }
  });

  test("the ESLint allowlist and route-decision name the same routes", () => {
    const ruleSrc = readFileSync(
      join(ROOT, "eslint-rules", "rules", "no-bare-api-route.mjs"),
      "utf8",
    );
    const decisionSrc = readFileSync(join(ROOT, "i18n", "route-decision.ts"), "utf8");
    // The ESLint rule's patterns are source-escaped regexes, e.g.
    //   /[\\/]app[\\/]api[\\/]hive[\\/]bootstrap[\\/]/
    // so the assertion reconstructs that exact literal rather than searching for
    // a word. The first cut built `new RegExp("chat")` and passed against the
    // rule file's own COMMENT prose -- deleting the real pattern would not have
    // failed it, which is the one thing this test exists to catch.
    for (const file of EXPECTED_PUBLIC_ROUTES) {
      const dir = file.replace(/\/route\.tsx?$/, "");
      // A rule entry is EITHER a directory prefix (`…/bootstrap[\\/]`) or an
      // exact route file (`…/url[\\/]route\.…`). Both are legitimate, and the
      // exact form is the safer one — it is what stops an `api/documents/`
      // prefix taking the admin upload route public by omission. A `[id]`
      // segment is regex-escaped as `\[id\]`, so the reconstruction escapes it
      // the same way rather than searching for a literal bracket.
      const seg = (part: string) => part.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      const body = dir.split("/").map(seg).join("[\\\\/]");
      const asPrefix = "[\\\\/]" + body + "[\\\\/]";
      const asExact = "[\\\\/]" + body + "[\\\\/]route\\.";
      const patterns = ruleSrc.slice(ruleSrc.indexOf("const PUBLIC_ROUTE_PATTERNS")).split("];")[0];
      assert.ok(
        patterns.includes(asPrefix) || patterns.includes(asExact),
        `${dir} must appear in no-bare-api-route's PUBLIC_ROUTE_PATTERNS as ${asPrefix} or ${asExact}`,
      );
      // route-decision covers a route EITHER by a literal prefix or, for a
      // route with a dynamic segment, by a pinned pattern. Both are checked,
      // and the assertion below is the point of the split: a dynamic route must
      // NOT be covered by a bare prefix, because a prefix passes every future
      // sibling through middleware's 401 backstop by omission.
      const decisionList = decisionSrc
        .slice(decisionSrc.indexOf("const PUBLIC_API_PATHS"))
        .split("] as const")[0];
      const prefixes = [...decisionList.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
      const path = `/${dir}`;
      const dynamic = dir.includes("[");
      const coveredByPrefix = prefixes.some((e) => path === e || path.startsWith(`${e}/`));

      if (dynamic) {
        assert.ok(
          !coveredByPrefix,
          `${dir} has a dynamic segment and must NOT be covered by a bare prefix — that would ` +
            `pass every future route under it as well`,
        );
        assert.deepEqual(
          routeDecision(path, false),
          { kind: "pass" },
          `${dir} must be matched by route-decision's PUBLIC_API_PATTERNS`,
        );
        // And the pattern must be tight: a deeper path must NOT pass.
        assert.deepEqual(
          routeDecision(`${path}/extra`, false),
          { kind: "apiUnauthorized" },
          `${dir}'s pattern must not match a deeper path`,
        );
      } else {
        assert.ok(
          coveredByPrefix,
          `${dir} must be covered by route-decision's PUBLIC_API_PATHS (has: ${prefixes.join(", ")})`,
        );
      }
    }
  });
});

describe("the admin surface stays behind the door §5.2 describes", () => {
  test("no HIVE admin route is reachable without a session", () => {
    const adminRoutes = routeFiles.map(rel).filter((f) => f.startsWith("api/hive/admin/"));
    assert.ok(adminRoutes.length > 0, "expected HIVE admin routes to exist");
    for (const file of adminRoutes) {
      const path = "/" + file.replace(/\/route\.tsx?$/, "");
      assert.deepEqual(
        routeDecision(path, false),
        { kind: "apiUnauthorized" },
        `${path} must 401 for an anonymous caller`,
      );
    }
  });

  test("the public prefix is per-route, never a wildcard over /api/hive", () => {
    // Allowing the whole `/api/hive/*` prefix is ADR-068's rejected alternative
    // 3, and it would take every future HIVE admin route public with it.
    assert.deepEqual(routeDecision("/api/hive/admin/topics", false), { kind: "apiUnauthorized" });
    assert.deepEqual(routeDecision("/api/hive/me/permissions", false), {
      kind: "apiUnauthorized",
    });
  });
});

describe("ADR-075 -- the employee chat is gone; the reply link and Siraaj's door remain", () => {
  test("/ask is no longer public: an anonymous visitor gets the login page", () => {
    assert.ok(!isPublicPath("/ask"));
    assert.ok(!isEmployeePath("/en/ask"));
    assert.deepEqual(routeDecision("/en/ask", false), { kind: "redirectLogin", locale: "en" });
  });

  test("the retired chat API is no longer passed through", () => {
    for (const path of ["/api/chat", "/api/chat/feedback", "/api/hive/bootstrap"]) {
      assert.deepEqual(routeDecision(path, false), { kind: "apiUnauthorized" }, path);
    }
  });

  test("the reply link stays reachable without an account", () => {
    assert.ok(isPublicPath("/reply/abc"));
    assert.ok(isEmployeePath("/en/reply/abc"));
    assert.deepEqual(routeDecision("/en/reply/abc", false), { kind: "intl" });
  });

  test("the bare origin sends an anonymous visitor to login (HR's back office)", () => {
    assert.deepEqual(routeDecision("/", false), { kind: "redirectLogin", locale: "en" });
    assert.deepEqual(routeDecision("/en", false), { kind: "redirectLogin", locale: "en" });
  });

  test("an authenticated visitor at the root still gets the dashboard", () => {
    assert.deepEqual(routeDecision("/en", true), { kind: "intl" });
  });

  test("a signed-in visitor IS still bounced off /login", () => {
    assert.deepEqual(routeDecision("/en/login", true), { kind: "redirectHome", locale: "en" });
  });

  test("/api/mcp reaches its handler, which gates itself with a bearer token", () => {
    assert.deepEqual(routeDecision("/api/mcp", false), { kind: "pass" });
    assert.deepEqual(
      routeDecision("/api/mcp/extra", false),
      { kind: "apiUnauthorized" },
      "exact path, never a prefix",
    );
    const src = readFileSync(join(ROOT, "app/api/mcp/route.ts"), "utf8");
    assert.ok(src.includes('withApiAuth("HIVE_MCP_TOKEN"'), "the token gate is missing");
    assert.ok(src.includes("withRateLimit("), "/api/mcp must be rate limited");
    assert.ok(
      src.indexOf("withRateLimit(") < src.indexOf("withApiAuth("),
      "withRateLimit composes OUTSIDE the auth wrapper",
    );
  });
});

describe("the public handlers read nothing an anonymous caller should not reach", () => {
  // ADR-068's separation requirement: "no employee route reads an authenticated
  // table". A source-level check, because the dangerous change (`prisma.user
  // .findMany` added to a public handler for a convenience) makes MORE things
  // work, not fewer, so no behavioural test would fail on it.
  const FORBIDDEN = ["prisma.user", "prisma.account", "prisma.session.", "prisma.auditLog"];

  const reachable = [
    "app/api/hive/reply/[token]/route.ts",
    "lib/hive/services/reply.ts",
    // Siraaj's door: bearer-gated, but the token belongs to another system
    // driving a language model, so it gets the same separation as a public
    // route — a tool is a public handler with extra steps.
    "app/api/mcp/route.ts",
    "lib/hive/mcp/protocol.ts",
    "lib/hive/mcp/tools.ts",
    "lib/hive/tools/escalate.ts",
    "lib/hive/services/escalation.ts",
    "lib/hive/tools/providers.ts",
    "lib/hive/tools/hrtags.ts",
    "lib/hive/tools/orgchart.ts",
    "lib/hive/tools/rotation.ts",
    "lib/hive/tools/discounts.ts",
  ];

  for (const file of reachable) {
    test(`${file} touches no authenticated table`, () => {
      const src = readFileSync(join(ROOT, file), "utf8")
        // Comments discuss these tables by name deliberately; only executable
        // source is asserted on.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const needle of FORBIDDEN) {
        assert.ok(!src.includes(needle), `${file} must not use ${needle}`);
      }
    });
  }

  test("every public route is rate limited", () => {
    for (const file of EXPECTED_PUBLIC_ROUTES) {
      const src = readFileSync(join(ROOT, "app", file), "utf8");
      assert.ok(
        src.includes("withRateLimit("),
        `${file} is unauthenticated and must be rate limited`,
      );
    }
  });
});
