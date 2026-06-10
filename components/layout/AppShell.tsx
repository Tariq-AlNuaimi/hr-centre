"use client";

import { Layout } from "antd";
import { SessionProvider } from "next-auth/react";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { AppFooter } from "./AppFooter";
import { Breadcrumbs } from "./Breadcrumbs";
import { BreadcrumbProvider } from "./BreadcrumbProvider";

const { Content } = Layout;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BreadcrumbProvider>
        <Layout style={{ minHeight: "100vh" }}>
          <AppHeader />
          <Layout>
            <AppSidebar />
            <Layout>
              {/* padding comes from .ant-layout-content (var(--density-page)
                  in app/globals.css) so the whole app's page density is one
                  token, not a per-shell hardcode. */}
              <Content style={{ minHeight: 360 }}>
                <Breadcrumbs />
                {children}
              </Content>
              <AppFooter />
            </Layout>
          </Layout>
        </Layout>
      </BreadcrumbProvider>
    </SessionProvider>
  );
}
