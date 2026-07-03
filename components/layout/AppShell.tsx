"use client";

import { SessionProvider } from "next-auth/react";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { AppFooter } from "./AppFooter";
import { Breadcrumbs } from "./Breadcrumbs";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { CommandPalette } from "./CommandPalette";

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
            <div className="flex flex-1 flex-col">
              {/* p-density-page keeps the app's page density on one token (was
                  .ant-layout-content in globals.css), not a per-shell hardcode. */}
              <main className="min-h-90 flex-1 p-density-page">
                <Breadcrumbs />
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
