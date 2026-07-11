# C12 — Testing, QA & accessibility (v2 exhaustive benchmark)

> Scored against the fixed stack (`package.json`, not CLAUDE.md): Next.js 16.2.9 RSC · React 19.2 · TS 5 · Node 22 · Prisma 7.7 · Tailwind/shadcn/Radix. **Current testing:** `node:test` + `tsx` (contracts, property, integration, eslint-rules) · `@testing-library/react` + `jsdom`/`global-jsdom` (components) · `@playwright/test` + `@axe-core/playwright` (uat/a11y) · `fast-check` (property) · coverage via `node --experimental-test-coverage`. Enterprise pivot: single enterprise tier, Docker-first, self-hosted, Claude-first. All lenses as-of **2026-07**; star counts point-in-time.

---

### Unit / integration runner — `node:test` vs Vitest vs Jest vs Bun test

One line: the runner that executes contract/integration/`lib/**` tests. **Current: `node:test` + `tsx`** (zero runtime deps, `--experimental-test-module-mocks` for mocking, `--experimental-test-coverage` for coverage).

| #   | Candidate               | Lens        | Stars (2026-07) | License    | Maturity             | Why it ranks                                                                                                                                               |
| --- | ----------------------- | ----------- | --------------- | ---------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Vitest**              | HS, OSS, BT | ~14.5k [1]      | MIT        | 4yr, v3/v4           | 5x Jest star velocity; 96% State-of-JS retention (#1) [4]; native ESM/TS, `vi.mock`, v8 coverage, watch, browser mode — the 2026 default for greenfield TS |
| 2   | **Jest**                | BT, ENT     | ~44k [1]        | MIT        | 12yr, v30            | Battle-tested at FAANG scale; huge ecosystem; but flat downloads, CJS-rooted, slower, no native ESM ergonomics                                             |
| 3   | **node:test** (current) | OSS, BT     | n/a (Node core) | MIT (Node) | Stable since Node 20 | Zero-dep, zero supply-chain surface, native to runtime, ideal for RSC/server/`lib` code without a browser env                                              |
| 4   | **Bun test**            | HS, OSS     | ~80k (Bun) [1]  | MIT        | v1.x                 | Fastest runner; Jest-compatible API; but ties test runtime to Bun, weaker Next-16/Node-native parity for this repo                                         |
| 5   | **Mocha**               | BT          | ~23k            | MIT        | 14yr                 | Venerable, flexible, but assertion/mocking/coverage all bolt-on; legacy choice                                                                             |
| 6   | **AVA**                 | OSS         | ~21k            | MIT        | Mature               | Concurrent-by-default minimalist runner; niche, declining momentum                                                                                         |

Head-to-head: **Vitest** has become the enterprise default for TS/ESM projects — native ESM + TS, first-class `vi.mock`/`vi.spyOn`, built-in v8 coverage, sub-second watch (8–28x faster reruns than Jest [2]), and it shares Vite config with the app. **Jest** only still wins for legacy CJS monorepos and React-Native (no Vitest support) — neither applies here. **node:test** is philosophically attractive (no dep, no CVE surface, native to Node 22, and genuinely the _best_ fit for testing RSC/async-server and `lib/**` logic that needs no DOM) but its mocking (`--experimental-test-module-mocks`) and coverage are still **experimental flags**, its DX (watch, reporters, `expect`-style assertions, module mocking) trails Vitest by a wide margin, and component testing forces the fragile `global-jsdom` register dance this repo already carries. **Bun test** is fastest but couples the runner to the Bun runtime — off-thesis for a Node-22/Docker deploy.

Recommendation: **REPLACE → Vitest** (Fit 4/5) for unit/integration/component running. The enterprise win is consolidation: one runner covers `lib` unit + component (jsdom _or_ browser mode) + integration, with non-experimental mocking and coverage, killing the `--experimental-test-module-mocks`/`global-jsdom`/separate-coverage sprawl. **Honest counter-case:** if the operator prizes zero-runtime-dep supply-chain minimalism above DX, **KEEP node:test** is defensible — it is the only "no added dependency" option and tests server/RSC code most naturally. Given the "perfect enterprise repo" framing (DX, mocking, coverage in the prompt), Vitest is the call. **ADR impact:** supersedes the node:test choice; net-new dev deps `vitest` + `@vitest/coverage-v8` (+ optional `@vitest/browser`), removes `tsx`-as-test-loader and the two experimental flags.

---

### Component testing — `@testing-library/react` + jsdom vs Vitest browser mode vs Playwright CT

One line: how React components (shadcn/Radix primitives, forms) get tested. **Current: RTL + `jsdom`/`global-jsdom`** driven by `node:test`.

| #   | Candidate                                    | Lens        | Stars (2026-07)           | License    | Maturity           | Why it ranks                                                                                                                                                               |
| --- | -------------------------------------------- | ----------- | ------------------------- | ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **RTL + jsdom** (current)                    | BT, HS, OSS | RTL ~19k / jsdom ~21k [7] | MIT        | Mature             | Industry-standard user-centric queries; fast; but jsdom only _approximates_ the browser (no layout, no native form validation, no `contenteditable`, polyfilled fetch) [7] |
| 2   | **Vitest browser mode**                      | HS, OSS     | (Vitest ~14.5k) [5]       | MIT        | v3/v4, stabilizing | Same RTL patterns but in **real Chromium/Firefox/WebKit** via Playwright provider; renders real layout/paint; single runner for unit+component [5]                         |
| 3   | **Playwright CT** (`@playwright/test` mount) | BT          | (Playwright ~75k+) [3]    | Apache-2.0 | Experimental       | Real-browser component mount; but serializes JSX across Node↔browser (can't use `react-dom` render directly), still experimental, adds a 2nd runner [5]                    |
| 4   | **RTL + happy-dom**                          | OSS         | ~4k                       | MIT        | Mature             | Faster jsdom alternative, better standards compliance in spots; still a DOM _emulation_, same class of gaps                                                                |
| 5   | **Cypress CT**                               | BT          | (Cypress ~48k) [3]        | MIT        | Stable             | Real-browser component testing with good DX; but ties you to Cypress + paid parallel cloud                                                                                 |

Head-to-head: the 2026 axis is **DOM-emulation (jsdom/happy-dom) vs real-browser (Vitest browser mode / Playwright CT / Cypress CT)**. jsdom is fastest but its approximation gaps (form validation APIs, layout, focus/visibility, `IntersectionObserver`) bite exactly the Radix/shadcn primitives this repo ships — dialogs, popovers, selects rely on measured layout and focus trapping that jsdom fakes. **Vitest browser mode** is the cleanest upgrade: identical RTL syntax, real rendering, one shared runner/config; ~2–4x slower per test than jsdom but shares one Chromium context. **Playwright CT** and **Cypress CT** each mean a _second_ runner and mental model.

Recommendation: **KEEP+HARDEN**, path to **Vitest browser mode** (Fit 4/5). If Vitest is adopted for the unit runner (above), enable browser mode for the Radix/shadcn primitive suites where jsdom lies, and keep jsdom for cheap pure-render/logic components. Drop the brittle `global-jsdom/register` + `tests/components/setup.ts` import chain. If node:test is kept instead, at minimum add `happy-dom` as an option and document the jsdom gaps. **ADR impact:** ties to the runner ADR; net-new `@vitest/browser` + reuse of the already-present Playwright browsers.

---

### E2E — `@playwright/test` vs Cypress vs WebdriverIO

One line: full-app browser flows (uat lean/full, RBAC, CRUD journeys). **Current: `@playwright/test`.**

| #   | Candidate                      | Lens             | Stars (2026-07)              | License    | Maturity           | Why it ranks                                                                                                          |
| --- | ------------------------------ | ---------------- | ---------------------------- | ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **@playwright/test** (current) | HS, BT, OSS, ENT | ~75k+ (some cite 91–95k) [3] | Apache-2.0 | Mature, MS-backed  | Free parallel sharding, trace viewer, cross-browser+WebKit, 33M weekly dl (5x Cypress) [3]; the 2026 default          |
| 2   | **Cypress**                    | BT, HS           | ~48k [3]                     | MIT        | Mature             | Best interactive debugger; but Chromium-family focus, paid Cloud for parallelization, 6.5M dl and flattening [3]      |
| 3   | **WebdriverIO**                | BT, OSS          | ~9k [8]                      | MIT        | v9, WebDriver BiDi | Only pick with first-class **mobile/Appium** + WebDriver-standard protocol; verbose config, smaller web mindshare [8] |
| 4   | **Puppeteer**                  | HS, OSS          | ~90k                         | Apache-2.0 | Mature             | Chrome automation lib, not a test framework; lower-level, no runner/assertions                                        |
| 5   | **Selenium**                   | BT, ENT          | ~32k                         | Apache-2.0 | 15yr               | Widest language/grid/enterprise reach; slow, flaky, dated DX                                                          |

Head-to-head: **Playwright** has decisively overtaken Cypress on every community metric by 2026 and, critically for this repo, its parallelization/sharding/trace-viewer are **all free and OSS** — no Cloud subscription, which matters for a self-hosted Docker-first enterprise deploy. **Cypress** keeps a loyal following for its time-travel debugger but its parallel execution is gated behind paid Cypery Cloud or custom infra, and cross-browser (WebKit/Safari) support lags. **WebdriverIO** only wins if native-mobile/Appium enters scope — not on this web thesis.

Recommendation: **KEEP** (Fit 5/5). Playwright is the correct, already-installed choice; nothing to change. It also anchors a11y (`@axe-core/playwright`) and visual regression (below) in one framework — the consolidation an enterprise repo wants. **ADR impact:** none; ratify.

---

### Accessibility — `@axe-core/playwright` vs pa11y vs Lighthouse a11y

One line: automated WCAG checks in CI/uat. **Current: `@axe-core/playwright`.**

| #   | Candidate                            | Lens             | Stars (2026-07)  | License            | Maturity                            | Why it ranks                                                                                                                                    |
| --- | ------------------------------------ | ---------------- | ---------------- | ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **@axe-core/playwright** (current)   | BT, HS, OSS, ENT | axe-core ~6k [6] | MPL-2.0 (axe-core) | Mature                              | Lowest-friction 2026 stack; WCAG 2.2 rules on real rendered DOM with actionable selectors; axe-core ~57% auto-catch (above 30–40% baseline) [6] |
| 2   | **pa11y / pa11y-ci**                 | OSS, BT          | ~5k              | LGPL-3.0           | v9.1 (axe-core 4.11 + Puppeteer 24) | Sitemap/URL-driven CLI; ideal when there's no app test suite to hang assertions on (marketing/docs/Storybook) [6]                               |
| 3   | **Lighthouse (a11y category)**       | HS, ENT          | ~29k             | Apache-2.0         | Mature                              | a11y audit **is axe-core underneath**, fewer rules, but bundles perf/SEO/best-practices; already in repo via `@lhci/cli` [6]                    |
| 4   | **axe DevTools (Deque, commercial)** | ENT              | closed           | Commercial         | Mature                              | Paid guided/IGT flows, broadest rule coverage, SLA/support; enterprise a11y programs                                                            |
| 5   | **jest-axe / vitest-axe**            | OSS              | ~1k              | MIT                | Mature                              | axe assertions at the component/unit layer — complements, not replaces, the E2E axe run                                                         |

Head-to-head: all roads lead to **axe-core** — Lighthouse and pa11y both embed it; the only question is the _harness_. `@axe-core/playwright` reuses the E2E browser context (no extra tooling) and yields per-violation selectors — the right default for an app with a Playwright suite. **pa11y-ci** shines for crawling many static URLs without a test suite (not this repo's shape). **Lighthouse a11y** is a strictly weaker subset of axe but is a free bonus since `@lhci/cli` already runs for perf. Automated tools cap at ~30–57% of real WCAG issues [6] — none substitute for manual/assistive-tech testing.

Recommendation: **KEEP+HARDEN** (Fit 5/5). Keep `@axe-core/playwright` as the gate; **add `vitest-axe`/`jest-axe`-style component-level axe assertions** so primitives fail fast at the component tier, and let the already-present Lighthouse CI report its axe subset for free. Consider Deque axe DevTools only if a formal enterprise a11y compliance program (VPAT/ACR) is required. **ADR impact:** minor; net-new component-axe dev dep aligned to the chosen runner.

---

### Property-based — `fast-check` vs alternatives

One line: generative/property tests (already used in `tests/property/*`). **Current: `fast-check`.**

| #   | Candidate                                    | Lens             | Stars (2026-07)      | License | Maturity       | Why it ranks                                                                                                                                  |
| --- | -------------------------------------------- | ---------------- | -------------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **fast-check** (current)                     | HS, BT, OSS, ENT | ~4.5k [9]            | MIT     | Mature, active | The de-facto JS/TS property-testing framework; TS-native, shrinking, runner-agnostic (node:test/Vitest/Jest); model-based + async support [9] |
| 2   | **jsverify**                                 | OSS              | ~1.5k [9]            | MIT     | **Stale**      | Original QuickCheck port; effectively unmaintained — avoid for new work                                                                       |
| 3   | **@fast-check/vitest** / `@fast-check/jest** | OSS              | (part of fast-check) | MIT     | Mature         | First-class runner bindings for fast-check — the integration path, not a rival                                                                |
| 4   | **testcheck-js**                             | OSS              | ~2k                  | BSD     | Older          | Immutable-style gen; smaller community, less TS ergonomics                                                                                    |

Head-to-head: not a real contest — **fast-check** is dominant, TS-first, actively maintained, and integrates with whatever runner you pick; **jsverify** and **testcheck** are legacy. If Vitest is adopted, `@fast-check/vitest` gives ergonomic `test.prop` bindings.

Recommendation: **KEEP** (Fit 5/5). Only change if the runner moves to Vitest — then add the `@fast-check/vitest` binding. **ADR impact:** none.

---

### Coverage — `node --experimental-test-coverage` vs c8 vs istanbul/nyc

One line: coverage collection for the `/ship` floor. **Current: `node --experimental-test-coverage`.**

| #   | Candidate                                       | Lens        | Stars (2026-07) | License | Maturity         | Why it ranks                                                                                                                                   |
| --- | ----------------------------------------------- | ----------- | --------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **c8**                                          | HS, OSS, BT | ~2.7k [10]      | ISC     | Mature           | Wraps native **V8** coverage — no instrumentation, ~5–6x faster than nyc, all standard reporters, `.c8rc` config; idiomatic for node:test [10] |
| 2   | **`@vitest/coverage-v8`**                       | HS, OSS     | (Vitest)        | MIT     | Mature           | Built into Vitest; zero extra wiring if Vitest is the runner — the natural pick post-migration                                                 |
| 3   | **node --experimental-test-coverage** (current) | OSS         | Node core       | MIT     | **Experimental** | Native, zero-dep; but still flagged experimental and **ignores c8/istanbul ignore comments** (only `node:coverage` pragmas) [10]               |
| 4   | **istanbul / nyc**                              | BT, ENT     | nyc ~5.6k       | ISC     | 10yr             | Battle-tested source-instrumentation, richest reporters/ignore semantics; slower, heavier, legacy                                              |
| 5   | **`@vitest/coverage-istanbul`**                 | OSS         | (Vitest)        | MIT     | Mature           | Istanbul provider inside Vitest for teams needing instrumentation fidelity                                                                     |

Head-to-head: three V8-based options (native flag, c8, Vitest-v8) vs the older instrumentation route (istanbul/nyc). Native V8 is fast and dependency-free but the **experimental flag + missing ignore-comment support** is a real gate-authoring friction. **c8** is the mature CLI wrapper over the same V8 engine and the idiomatic partner for node:test. If the runner becomes **Vitest**, `@vitest/coverage-v8` folds coverage into the runner with thresholds — no separate tool at all.

Recommendation: **REPLACE → c8** if node:test is kept (drop the experimental flag for a mature, ignore-comment-aware wrapper); **or `@vitest/coverage-v8`** if the runner migrates (Fit 4/5). Either removes the "experimental" caveat from the `/ship` coverage gate. **ADR impact:** small; net-new `c8` _or_ folds into the Vitest dep.

---

### API mocking — MSW vs nock (**NET-NEW**)

One line: HTTP mocking for services/routes (email, external APIs, `/api/v1` consumers). **NET-NEW — none yet** (repo has no HTTP-mock layer today).

| #   | Candidate                           | Lens             | Stars (2026-07) | License | Maturity   | Why it ranks                                                                                                                                                                                                 |
| --- | ----------------------------------- | ---------------- | --------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **MSW (Mock Service Worker)**       | HS, BT, OSS, ENT | ~16k [11]       | MIT     | v2, mature | Network-layer interception (Service Worker in browser, `@mswjs/interceptors` in Node); one mock reused across unit/component/E2E; Fetch-API-shaped handlers; concurrent-test safe via AsyncLocalStorage [11] |
| 2   | **nock**                            | BT, OSS          | ~13k [11]       | MIT     | 11yr       | Node-only `http`/`https` interception; **does not intercept native fetch/undici** (Node 18+) without shims; own DSL; forces serial tests [11]                                                                |
| 3   | **@mswjs/interceptors**             | OSS              | ~800            | MIT     | Mature     | The low-level engine under MSW; use directly only for bespoke needs                                                                                                                                          |
| 4   | **undici MockAgent**                | OSS              | (undici)        | MIT     | Mature     | Native fetch/undici mocking with zero deps — good for pure-fetch server code, no browser story                                                                                                               |
| 5   | **axios-mock-adapter / fetch-mock** | OSS              | ~3k / ~2k       | MIT     | Mature     | Client-patching mocks; simpler but leak the transport into tests                                                                                                                                             |

Head-to-head: **MSW** is the 2026 default and the clear enterprise fit — it intercepts at the network layer so the same handlers serve jsdom, browser-mode, Playwright, and Node; it speaks the Fetch API (matching Next 16/undici native fetch); and it supports concurrent tests. **nock**'s fatal 2026 gap is that Node's native `fetch` (undici) bypasses the `http` module it patches — exactly what Next 16 server code uses — plus weaker TS and forced serial tests. **undici MockAgent** is a zero-dep alternative _only_ for pure server-fetch code with no browser reuse.

Recommendation: **ADOPT (net-new) → MSW** (Fit 5/5). It is the one mocking layer that spans every test tier this repo runs and correctly handles native fetch. For narrow server-only fetch stubs, `undici MockAgent` is a zero-dep fallback. Avoid nock (native-fetch blind spot). **ADR impact:** new ADR + dev dep `msw`; wire a shared `tests/msw/handlers.ts` + server setup.

---

### Visual regression — Playwright screenshots vs Chromatic vs Percy vs Loki (**NET-NEW**)

One line: pixel/visual diffing of screens & component states. **NET-NEW — none yet** (repo does design-QA screenshots via Playwright MCP but no baseline-diff gate).

| #   | Candidate                           | Lens        | Stars (2026-07)         | License    | Maturity            | Why it ranks                                                                                                                |
| --- | ----------------------------------- | ----------- | ----------------------- | ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Playwright `toHaveScreenshot()`** | HS, BT, OSS | (Playwright ~75k+) [12] | Apache-2.0 | Mature              | Free, in-framework, pixelmatch diffs + diff images; covers ~80% of needs; self-hostable — no SaaS [12]                      |
| 2   | **Chromatic**                       | ENT, BT     | closed (SaaS)           | Commercial | Mature              | Storybook-native — every story a visual test, TurboSnap cost control, review workflow; best for component-driven teams [12] |
| 3   | **Percy (BrowserStack)**            | ENT, BT     | closed (SaaS)           | Commercial | Mature              | Cross-browser cloud rendering, smarter diffing/AI review (~40% fewer false positives), team approval flow; $199+/mo [12]    |
| 4   | **Loki**                            | OSS         | ~1.8k [12]              | MIT        | **Low maintenance** | OSS Storybook visual testing, self-hostable; but slow release cadence — sustainability risk [12]                            |
| 5   | **BackstopJS**                      | OSS, BT     | ~6.8k                   | MIT        | Mature              | Config-driven Puppeteer/Playwright visual regression; self-hosted, no Storybook coupling; heavier setup                     |
| 6   | **Applitools Eyes**                 | ENT         | closed                  | Commercial | Mature              | AI "visual AI" diffing, enterprise SLA/compliance; premium price                                                            |

Head-to-head: the category splits into **self-owned snapshot libs** (Playwright, BackstopJS, Loki) and **AI-diffing SaaS** (Chromatic, Percy, Applitools). For a **Docker-first, self-hosted** enterprise repo, the SaaS options add egress + per-screenshot billing + vendor lock-in that conflict with the deploy-per-tenant/air-gap posture. **Playwright `toHaveScreenshot()`** is already-installed, free, and self-hosted; its weaknesses (font/AA noise across Docker CI, manual baseline updates on redesigns) are manageable by pinning a Docker render image. **Chromatic** is compelling _only if_ Storybook is adopted. **Loki**'s thin maintenance is a real risk.

Recommendation: **ADOPT (net-new) → Playwright `toHaveScreenshot()`** (Fit 5/5) as the self-hosted visual gate, run in a **pinned Docker image** to kill font/AA flake, wired into `/design-qa`. Add **Chromatic** as an option _iff_ a Storybook is introduced (`ADD-AS-OPTION`). Avoid Percy/Applitools (SaaS lock-in vs air-gap thesis) and Loki (maintenance risk). **ADR impact:** new ADR for the visual-baseline gate; Docker render-image pin; no new runtime dep (Playwright already present).

---

## Category verdict table

| Item                    | Current                             | Recommendation                                                                                      | Net-new deps                          | ADR impact           | Priority        |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------- | --------------- |
| Unit/integration runner | `node:test` + tsx                   | **REPLACE → Vitest** (KEEP node:test defensible if dep-minimalism trumps DX)                        | `vitest`, `@vitest/coverage-v8`       | Supersede runner ADR | **P1**          |
| Component testing       | RTL + jsdom/global-jsdom            | **KEEP+HARDEN** → Vitest browser mode for Radix/shadcn primitives                                   | `@vitest/browser` (reuses Playwright) | Tie to runner ADR    | P1              |
| E2E                     | `@playwright/test`                  | **KEEP** (ratify)                                                                                   | —                                     | None                 | **P0 (ratify)** |
| Accessibility           | `@axe-core/playwright`              | **KEEP+HARDEN** → add component-level axe; Lighthouse subset free                                   | `vitest-axe`/`jest-axe`               | Minor                | P1              |
| Property-based          | `fast-check`                        | **KEEP** (add `@fast-check/vitest` if runner moves)                                                 | — (opt binding)                       | None                 | P2              |
| Coverage                | `node --experimental-test-coverage` | **REPLACE → c8** (or `@vitest/coverage-v8` post-migration)                                          | `c8` _or_ folded into Vitest          | Small                | P1              |
| API mocking             | none                                | **ADOPT → MSW** (undici MockAgent for server-only fetch)                                            | `msw`                                 | New ADR              | **P1**          |
| Visual regression       | none (MCP screenshots only)         | **ADOPT → Playwright `toHaveScreenshot()`** in pinned Docker image; Chromatic optional w/ Storybook | — (Playwright present)                | New ADR              | P1              |

**Consolidation thesis:** the highest-leverage move is picking **Vitest as the single unit/component runner** (folding in mocking + v8 coverage + browser mode), keeping **Playwright** as the single browser framework (E2E + axe a11y + visual regression), and adding **MSW** as the single network-mock layer — three tools cover eight concerns, which is the enterprise-repo simplification. If dep-minimalism is the higher value, KEEP node:test but move coverage to c8 and accept the DX/mocking gaps.

---

## Sources

1. Vitest vs Jest 2026 benchmarks & stars — https://www.pkgpulse.com/blog/vitest-3-vs-jest-30-2026 · https://npmtrends.com/jest-vs-vitest
2. Jest vs Vitest watch-mode benchmark — https://getautonoma.com/blog/jest-vs-vitest-2026
3. Playwright vs Cypress 2026 (stars, downloads, cost) — https://getautonoma.com/blog/playwright-vs-cypress · https://tech-insider.org/cypress-vs-playwright-2026/
4. State of JS 2024 testing retention — cited via https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/
5. Vitest browser mode vs Playwright CT — https://www.epicweb.dev/vitest-browser-mode-vs-playwright · https://www.sitepoint.com/vitest-4-browser-mode-component-testing-without-playwright/
6. axe-core vs pa11y vs Lighthouse a11y (2026) — https://crosscheck.cloud/blogs/axe-vs-wave-vs-pa11y-accessibility-testing/ · https://qaskills.sh/blog/playwright-accessibility-testing-axe-complete-guide · https://playwright.dev/docs/accessibility-testing
7. jsdom limitations / RTL — https://www.epicweb.dev/why-i-won-t-use-jsdom · https://testing-library.com/docs/dom-testing-library/setup/
8. WebdriverIO v9 status — https://webdriver.io/ · https://github.com/webdriverio/webdriverio
9. fast-check & alternatives — https://github.com/dubzzz/fast-check · https://fast-check.dev/ · https://github.com/jsverify/jsverify
10. c8 vs nyc/istanbul vs node native coverage — https://www.pkgpulse.com/guides/c8-vs-nyc-vs-istanbul-javascript-code-coverage-2026 · https://github.com/bcoe/c8
11. MSW vs nock (native fetch/undici) — https://mswjs.io/docs/comparison/ · https://www.pkgpulse.com/guides/msw-vs-nock-vs-axios-mock-adapter-api-mocking-2026 · https://github.com/mswjs/msw/issues/2165
12. Visual regression tools 2026 — https://crosscheck.cloud/blogs/best-visual-regression-testing-tools-2026/ · https://getautonoma.com/blog/visual-regression-testing-tools · https://bug0.com/knowledge-base/playwright-visual-regression-testing
