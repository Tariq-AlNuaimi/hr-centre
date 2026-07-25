# Recipe: Storybook for the shared component library

> `/scale-up` → developer-experience optimization **O7**.
> Sets up **Storybook 8** to develop, document, and visually review the template's
> shared components — `DataTable`, `Chart`, `KanbanBoard`, `EmptyState`,
> `ConfirmAction` — in isolation, with the **`next-intl` + `ThemeProvider`** context
> they need to render.
>
> **CORRECTED 2026-07-25 (OPEN-ITEMS item 18):** this recipe still described the shared
> components as **AntD** components wrapped in `ConfigProvider`. AntD was removed in
> **ADR-029** (the UI is Tailwind v4 + shadcn/Radix), so the decorator below imported a
> package that is no longer installed — following it produced `Cannot find module 'antd'`
> on the first run. The decorator now mirrors what `app/[locale]/layout.tsx` actually
> provides. Not executed here (Storybook is a large devDependency install this container
> shouldn't add on spec) — the correction is a code-vs-doc reconciliation, not a run.

## When to add it

Add this when **building/iterating on the shared component layer** is a real
activity:

- You're extending `components/shared/*` (new variants, new shared widgets) and
  want to see them in isolation without spinning up a full page + auth + data.
- You want a visual catalog to show stakeholders the building blocks, or to hand to
  the IT team at `/handoff` as living component docs.
- You want a seam for visual-regression snapshots later (Storybook + Chromatic /
  Playwright).

**Don't** add it to a throwaway one-entity prototype — the shipped pages _are_ the
review surface there. This is for forks where the component library itself is being
grown.

> **Lean-base note (ADR-014):** Storybook is **dev-only tooling and a heavy
> devDependency tree** (the `storybook` CLI + `@storybook/nextjs` + addons pull in a
> lot). It is deliberately kept **OUT of the base** `package.json` for the same
> reason the recipe library is out of the base — forks that don't need it shouldn't
> pay the install/maintenance cost the IT team inherits. Add it per-fork. Everything
> below is `devDependencies` and a `.storybook/` config dir; **none of it ships to
> the client or the Vercel runtime.**

## Deps

```bash
# Scaffolds .storybook/ + a few example stories and picks the Next.js framework.
npx storybook@^8 init
```

`storybook init` detects Next.js and installs `@storybook/nextjs` (which wires
`next.config.ts`, SWC, CSS, and the App Router shims for you) plus the standard
addons (`@storybook/addon-essentials`, etc.), all as **devDependencies**. If you
prefer to be explicit instead of the init wizard:

```bash
npm install -D storybook@^8 @storybook/nextjs@^8 @storybook/addon-essentials@^8 \
  @storybook/react@^8
```

> `@storybook/nextjs` (not `@storybook/react-vite`) is the right framework here — it
> understands `next/navigation`, `next/image`, and the App Router so components that
> call `useRouter()` (like an RSC client island, or `ConfirmAction`) don't crash in
> a story.

## The context decorator (the part that's template-specific)

The shared components are **Tailwind + shadcn/Radix** components (ADR-029). Several read
`next-intl` translations via `useTranslations` (`DataTable`'s search placeholder + empty
text, `EmptyState`, `ConfirmAction`), so rendered bare in a story they throw "No intl
context found". Theming is **CSS-variable driven** — `app/tokens.css` plus a `dark` class
on a wrapping element — not a JS theme object, so a story only needs the class toggled.
RTL comes from the `dir` attribute (Radix reads it via `DirectionProvider`). Wrap every
story in a **global decorator** mirroring what `app/[locale]/layout.tsx` provides at
runtime (`NextIntlClientProvider` → `ThemeProvider` → `QueryProvider`).

```tsx
// .storybook/decorators.tsx
import React from "react";
import type { Decorator } from "@storybook/react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
// Only import a second locale if the fork enabled one (project.config.json `locales`).
// The default template ships English-only, so `messages/ar.json` stays inert.
import "../app/globals.css"; // tokens.css + Tailwind — the actual styling source

// Mirrors app/[locale]/layout.tsx minus the cookie/localStorage persistence (a story has
// no request to seed from). Theme is a CSS class, not a JS theme object: `dark` on a
// wrapper flips every token in app/tokens.css. `theme` and `locale` come from the
// Storybook globals (toolbar) configured below.
export const withProviders: Decorator = (Story, context) => {
  const isDark = context.globals.theme === "dark";
  const locale = (context.globals.locale as string) ?? "en";
  const direction = ["ar", "he", "fa", "ur"].includes(locale) ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider locale={locale} messages={enMessages} timeZone="UTC">
      <DirectionProvider dir={direction}>
        <div className={isDark ? "dark" : undefined} dir={direction}>
          {/* bg-background/text-foreground so the token surface is visible in both themes */}
          <div className="bg-background text-foreground" style={{ padding: 24 }}>
            <Story />
          </div>
        </div>
      </DirectionProvider>
    </NextIntlClientProvider>
  );
};
```

Register it globally and add theme/locale toolbar toggles so you can flip
light/dark and en/ar (the RTL locale) per story:

```tsx
// .storybook/preview.tsx
import type { Preview } from "@storybook/react";
import { withProviders } from "./decorators";

const preview: Preview = {
  decorators: [withProviders],
  globalTypes: {
    theme: {
      description: "Theme (dark class on the wrapper)",
      defaultValue: "light",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
    locale: {
      description: "Locale (ar = RTL)",
      defaultValue: "en",
      toolbar: {
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "ar", title: "العربية (RTL)" },
        ],
      },
    },
  },
};

export default preview;
```

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  framework: { name: "@storybook/nextjs", options: {} },
  stories: ["../components/**/*.stories.@(tsx|mdx)"],
  addons: ["@storybook/addon-essentials"],
  staticDirs: ["../public"],
};

export default config;
```

> `@storybook/nextjs` auto-mocks `next/navigation`, so a component calling
> `useRouter()` renders; `router.push` is a no-op action in the story. If a story
> needs a specific router state, set it via the `nextjs.navigation` parameter (see
> the Storybook Next.js docs).

## Example stories

### `components/shared/EmptyState.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";

const meta: Meta<typeof EmptyState> = {
  title: "Shared/EmptyState",
  component: EmptyState,
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: { actionLabel: "Create the first item", onAction: () => {} },
};
```

### `components/shared/Chart.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Chart } from "./Chart";

const meta: Meta<typeof Chart> = { title: "Shared/Chart", component: Chart };
export default meta;
type Story = StoryObj<typeof Chart>;

const data = [
  { month: "Jan", revenue: 4200 },
  { month: "Feb", revenue: 5100 },
  { month: "Mar", revenue: 4800 },
];

export const Line: Story = {
  args: { type: "line", data, xKey: "month", yKey: "revenue", height: 280 },
};
export const Bar: Story = {
  args: { type: "bar", data, xKey: "month", yKey: "revenue", height: 280 },
};
export const Pie: Story = {
  args: {
    type: "pie",
    data: [
      { name: "TODO", value: 12 },
      { name: "DONE", value: 30 },
    ],
    nameKey: "name",
    valueKey: "value",
    height: 280,
  },
};
```

### `components/shared/DataTable.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  name: string;
  role: string;
}

const meta: Meta<typeof DataTable<Row>> = {
  title: "Shared/DataTable",
  component: DataTable<Row>,
};
export default meta;
type Story = StoryObj<typeof DataTable<Row>>;

const rows: Row[] = [
  { id: "1", name: "Aisha", role: "ADMIN" },
  { id: "2", name: "Bilal", role: "EDITOR" },
];

export const Default: Story = {
  args: {
    dataSource: rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    searchable: true,
    columns: [
      { title: "Name", dataIndex: "name", key: "name", sorter: true },
      { title: "Role", dataIndex: "role", key: "role" },
    ],
  },
};

export const Empty: Story = { args: { ...Default.args, dataSource: [], total: 0 } };
```

> `KanbanBoard` and `ConfirmAction` get stories the same way — pass `columns` +
> `items` + a `renderCard` for the board; render a trigger button + `onConfirm`
> action for `ConfirmAction`. Both render fine under the decorator above
> (`KanbanBoard` needs no extra context; `ConfirmAction` uses the Radix Dialog
> context the decorator provides).

> **`*.impl.tsx` split:** `Chart` and `KanbanBoard` ship as a thin wrapper +
> a `next/dynamic`-loaded `*.impl.tsx` (to keep recharts / dnd-kit out of the
> initial bundle). Stories import the **public** `./Chart` / `./KanbanBoard`
> wrapper, not the `.impl` — that's the supported entry point and dynamic import
> resolves fine in Storybook.

## Scripts

Add to `package.json` (dev-only):

```json
{
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

## Files to change in a fork

| File                              | Change                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| `.storybook/main.ts`              | **New** — framework + story glob                                            |
| `.storybook/preview.tsx`          | **New** — global decorator + theme/locale toolbar                           |
| `.storybook/decorators.tsx`       | **New** — `next-intl` + `DirectionProvider` + `dark`-class theme decorator  |
| `components/shared/*.stories.tsx` | **New** — one per shared component                                          |
| `package.json`                    | add Storybook **devDependencies** + `storybook` / `build-storybook` scripts |
| `.gitignore`                      | add `storybook-static/` (the `build-storybook` output)                      |

No base source/config change — `next.config.ts`, `lib/`, the components themselves
are untouched. Storybook reads them; it doesn't modify them.

## How to test

1. `npm run storybook` → opens `http://localhost:6006`; the sidebar lists
   `Shared/EmptyState`, `Shared/Chart`, `Shared/DataTable`, etc.
2. Flip the **theme** toolbar to Dark → components re-render with the dark
   token surface (proves the `dark`-class decorator is wired).
3. Flip the **locale** toolbar to العربية → the layout flips **RTL** and
   `next-intl`-driven strings (DataTable search placeholder, empty text) switch
   language (proves the `next-intl` decorator is wired).
4. `npm run build-storybook` → builds a static `storybook-static/` with no errors
   (catches any component that fails outside the app context).
5. `/ship` is unaffected — `.stories.tsx` files aren't picked up by `tsc`'s app
   build paths or the `*.test.ts` runner; if a fork's `tsconfig` includes them,
   ensure Storybook's types are installed so typecheck stays green.

## Rollback

```bash
npx storybook@latest remove   # or manually:
# delete .storybook/, components/**/*.stories.tsx, the two package.json scripts,
# and uninstall the storybook devDependencies, then `npm install`.
```

Nothing in the base depended on Storybook, so removal is clean — the app builds and
ships exactly as before.
