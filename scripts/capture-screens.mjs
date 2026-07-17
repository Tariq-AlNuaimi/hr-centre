#!/usr/bin/env node
// scripts/capture-screens.mjs — the visual-iteration capture harness (V2-301).
//
// After building or altering a screen, the agent MUST capture it, VIEW the images, and
// self-critique against the 10-point rubric (V2-307) before affirming the work — an
// affirmation with no attached captures is invalid (V2-301). This is the tool that produces
// those captures: it logs in (react-hook-form needs real keystrokes, so `pressSequentially`,
// not `fill` — see docs/agent-memory.md), then screenshots each route across the matrix
//   {desktop, mobile} × {light, dark} × {enabled locales}
// into docs/verification/<feature>/. Locales come from project.config.json (ar/he/fa/ur add
// an RTL variant automatically when enabled; English-only forks capture en only).
//
// Usage:
//   node scripts/capture-screens.mjs --feature asset-tracker --routes /asset,/asset/new [--base http://localhost:3000] [--no-login]
// Prereqs (local run): a running app + DB — see the agent-memory "browser QA & egress"
// 2026-07-17 recipe (native Postgres + `npm run dev`). Chromium resolves from
// PLAYWRIGHT_BROWSERS_PATH (web session) or the bundled binary (off-platform).
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const FEATURE = arg("feature");
if (!FEATURE) {
  console.error(
    "usage: capture-screens.mjs --feature <name> --routes <p1,p2> [--base URL] [--no-login]",
  );
  process.exit(2);
}
const BASE = arg("base", "http://localhost:3000");
const ROUTES = (arg("routes", "/") || "/")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);
const DO_LOGIN = !hasFlag("no-login");
const OUT = path.join("docs/verification", FEATURE);

function readEnv() {
  try {
    return Object.fromEntries(
      readFileSync(".env", "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

function enabledLocales() {
  try {
    const cfg = JSON.parse(readFileSync("project.config.json", "utf8"));
    const locales = Array.isArray(cfg.locales) && cfg.locales.length ? cfg.locales : ["en"];
    return locales;
  } catch {
    return ["en"];
  }
}

function resolveChromium() {
  if (process.env.PW_EXECUTABLE_PATH && existsSync(process.env.PW_EXECUTABLE_PATH))
    return process.env.PW_EXECUTABLE_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const rev = (d) => Number(d.slice("chromium-".length)) || 0;
    for (const d of readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => rev(a) - rev(b))
      .reverse()) {
      const c = path.join(root, d, "chrome-linux", "chrome");
      if (existsSync(c)) return c;
    }
  } catch {
    /* bundled */
  }
  return undefined;
}

const env = readEnv();
const locales = enabledLocales();
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const themes = ["light", "dark"];

async function login(ctx, locale) {
  const page = await ctx.newPage();
  // Retry the whole login up to 3× — the credentials form occasionally races (the auth
  // POST + session round-trip), and a context that stays on /login silently captures the
  // login screen instead of the target. Verify we actually left /login before returning.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/${locale}/login`, { waitUntil: "networkidle" });
    // react-hook-form ignores programmatic fill(); type real keystrokes.
    await page
      .getByLabel(/email|بريد/i)
      .pressSequentially(env.SEED_ADMIN_EMAIL ?? "", { delay: 12 });
    await page
      .getByLabel(/password|كلمة/i)
      .pressSequentially(env.SEED_ADMIN_PASSWORD ?? "", { delay: 12 });
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByRole("button", { name: /sign in|log in|دخول/i }).click(),
    ]);
    await page
      .waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    if (!page.url().includes("/login")) break;
    if (attempt === 3)
      console.warn(`[capture-screens] WARN: login did not leave /login after 3 tries`);
  }
  await page.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromium() });
const written = [];
try {
  for (const locale of locales) {
    for (const [vpName, viewport] of Object.entries(viewports)) {
      for (const theme of themes) {
        const ctx = await browser.newContext({ viewport, colorScheme: theme });
        if (DO_LOGIN) await login(ctx, locale);
        const page = await ctx.newPage();
        for (const route of ROUTES) {
          await page.goto(`${BASE}/${locale}${route}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(700);
          const slug = route === "/" ? "root" : route.replace(/^\//, "").replace(/\//g, "-");
          const localeTag = locales.length > 1 ? `.${locale}` : "";
          const file = path.join(OUT, `${slug}.${vpName}.${theme}${localeTag}.png`);
          await page.screenshot({ path: file, fullPage: true });
          written.push(file);
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`[capture-screens] ${written.length} capture(s) → ${OUT}/`);
for (const f of written) console.log(`  ${f}`);
console.log(
  `[capture-screens] NOW VIEW these images and self-critique vs the 10-point rubric (V2-301/V2-307) before affirming the screen.`,
);
