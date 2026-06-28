"use client";

import { Layout, Typography } from "antd";

const { Footer } = Layout;
const { Text } = Typography;

export function AppFooter() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "My App";

  return (
    <Footer style={{ textAlign: "center", padding: "12px 24px" }}>
      <Text type="secondary">
        {appName} - {new Date().getFullYear()}
      </Text>
    </Footer>
  );
}
