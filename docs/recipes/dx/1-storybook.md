# Recipe: Storybook for the shared component library

> `/scale-up` → developer-experience optimization **O7**.
> Sets up **Storybook 8** to develop, document, and visually review the template's
> shared components — `DataTable`, `Chart`, `KanbanBoard`, `EmptyState`,
> `ConfirmAction` — in isolation, with the **AntD `ConfigProvider` + `next-intl`**
> context they need to render.

## When to add it

Add this when **building/iterating on the shared component layer** is a real
activity:

- You're extending `components/shared/*` (new variants, new shared widgets) and
  want to see them in isolation without spinning up a full page + auth + data.
- You want a visual catalog to show stakeholders the building blocks, or to hand to
  the IT team at `/handoff` as living component docs.
- You want a seam for visual-regression snapshots later (Storybook + Chromatic /
  Playwright).

**Don't** add it to a throwaway one-entity prototype — the shipped pages *are* the
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

The shared components are **AntD** components that read `ConfigProvider` (theme +
RTL `direction`) and several read `next-intl` translations via `useTranslations`
(`DataTable`'s search placeholder + empty text, `EmptyState`, `ConfirmAction`).
Rendered bare in a story they'd throw "No intl context found" / render
unstyled. Wrap every story in a **global decorator** that supplies both — mirroring
what `app/[locale]/layout.tsx` provides at runtime (`NextIntlClientProvider` →
`AntdRegistry` → `ThemeProvider` which holds the `ConfigProvider`).

```tsx
// .storybook/decorators.tsx
import React from "react";
import type { Decorator } from "@storybook/react";
import { ConfigProvider, theme, App } from "antd";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import arMessages from "../messages/ar.json";

// Mirrors components/layout/ThemeProvider.tsx's ConfigProvider + next-intl, minus
// the cookie/localStorage persistence (a story has no request to seed from). The
// `dark` and `locale` values come from Storybook globals (toolbar) set below.
export const withProviders: Decorator = (Story, context) => {
  const isDark = context.globals.theme === "dark";
  const locale = (context.globals.locale as "en" | "ar") ?? "en";
  const direction = locale === "ar" ? "rtl" : "ltr";
  const messages = locale === "ar" ? arMessages : enMessages;

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <ConfigProvider
        direction={direction}
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: { colorPrimary: "#1677ff", borderRadius: 6 },
        }}
      >
        {/* AntD <App> provides the message/notification/modal context that
            ConfirmAction and the use-notify hook rely on. */}
        <App>
          <div style={{ padding: 24 }}>
            <Story />
          </div>
        </App>
      </ConfigProvider>
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
      description: "AntD theme",
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
    data: [{ name: "TODO", value: 12 }, { name: "DONE", value: 30 }],
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

interface Row { id: string; name: string; role: string }

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
> (`KanbanBoard` needs no extra context; `ConfirmAction` uses the AntD `<App>` modal
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

| File | Change |
|---|---|
| `.storybook/main.ts` | **New** — framework + story glob |
| `.storybook/preview.tsx` | **New** — global decorator + theme/locale toolbar |
| `.storybook/decorators.tsx` | **New** — AntD `ConfigProvider` + `next-intl` provider |
| `components/shared/*.stories.tsx` | **New** — one per shared component |
| `package.json` | add Storybook **devDependencies** + `storybook` / `build-storybook` scripts |
| `.gitignore` | add `storybook-static/` (the `build-storybook` output) |

No base source/config change — `next.config.ts`, `lib/`, the components themselves
are untouched. Storybook reads them; it doesn't modify them.

## How to test

1. `npm run storybook` → opens `http://localhost:6006`; the sidebar lists
   `Shared/EmptyState`, `Shared/Chart`, `Shared/DataTable`, etc.
2. Flip the **theme** toolbar to Dark → components re-render with the dark
   algorithm (proves the `ConfigProvider` decorator is wired).
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
