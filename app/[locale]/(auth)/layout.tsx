"use client";

import { Typography, theme } from "antd";
import { brand } from "@/brand.config";

const { Title, Paragraph, Text } = Typography;

/**
 * Split-screen auth shell: a branded panel beside the form. The panel carries
 * the brand gradient + mark + value line (white-labelled from brand.config); it
 * collapses on small screens so the form stays front-and-centre on mobile.
 * Tokens only — gradient is colorPrimary → colorPrimaryActive (no raw hex).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <aside
        className="auth-brand-panel"
        style={{
          flex: "1 1 0",
          background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryActive} 100%)`,
          color: token.colorTextLightSolid,
          padding: 48,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              inlineSize: 36,
              blockSize: 36,
              borderRadius: token.borderRadius,
              background: "rgba(255, 255, 255, 0.16)",
              color: token.colorTextLightSolid,
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {brand.monogram}
          </span>
          <Text strong style={{ color: token.colorTextLightSolid, fontSize: 18 }}>
            {brand.appName}
          </Text>
        </div>

        <div style={{ maxWidth: 440 }}>
          <Title
            level={2}
            style={{ color: token.colorTextLightSolid, marginBlockEnd: 12 }}
          >
            {brand.appName}
          </Title>
          <Paragraph
            style={{ color: "rgba(255, 255, 255, 0.82)", fontSize: 16, marginBlockEnd: 0 }}
          >
            {brand.description}
          </Paragraph>
        </div>

        <Text style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 13 }}>
          © {brand.appName}
        </Text>
      </aside>

      <main
        style={{
          flex: "1 1 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: token.colorBgLayout,
        }}
      >
        {children}
      </main>
    </div>
  );
}
