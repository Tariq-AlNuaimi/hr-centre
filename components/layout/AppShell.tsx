"use client";

import { SessionProvider } from "next-auth/react";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { AppFooter } from "./AppFooter";
import { Breadcrumbs } from "./Breadcrumbs";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { CommandPalette } from "./CommandPalette";
import { ModuleTabs } from "./ModuleTabs";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BreadcrumbProvider>
        {/* ⌘K command palette — mounted once; opens on the shortcut or the
            header search button (OPEN_COMMAND_PALETTE event). */}
        <CommandPalette />
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <div className="flex flex-1">
            <AppSidebar />
            {/*
              `min-w-0` is doing real work here, not tidying. A flex item's default
              `min-width: auto` refuses to shrink below its CONTENT's width — so a
              wide table inside this column pushed the column itself past the
              viewport, and the whole PAGE scrolled sideways instead of the table
              scrolling inside its own `overflow-x: auto` container. Measured at
              375px before this: /people ran to 1072px and /goal-setting to 1114px
              against a 375px viewport. The footer showed up as the widest element
              in the probe only because it stretched to match.
            */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* p-density-page keeps the app's page density on one token (was
                  .ant-layout-content in globals.css), not a per-shell hardcode. */}
              <main className="min-h-90 flex-1 p-density-page">
                <Breadcrumbs />
                <ModuleTabs />
                {children}
              </main>
              <AppFooter />
            </div>
          </div>
        </div>
      </BreadcrumbProvider>
    </SessionProvider>
  );
}
