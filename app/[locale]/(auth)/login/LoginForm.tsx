"use client";

import { Card, Form, Input, Button, Typography, Divider, App } from "antd";
import { LockOutlined, MailOutlined, WindowsOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

const { Title } = Typography;

// Server-derived flags (lib/auth: ssoConfigured / ssoEnforced). Passed in so the
// secret-bearing env stays server-side; this client component only sees booleans.
export function LoginForm({
  ssoConfigured,
  ssoEnforced,
}: {
  ssoConfigured: boolean;
  ssoEnforced: boolean;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // When SSO is enforced, credentials are removed from the provider list
  // (lib/auth), so the password form is hidden and SSO is the only way in.
  const showCredentials = !(ssoConfigured && ssoEnforced);

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        message.error(t("invalidCredentials"));
      } else {
        router.push(`/${locale}`);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  function onSso() {
    setSsoLoading(true);
    // Full redirect to the IdP; on return Auth.js lands the session and routes home.
    signIn("microsoft-entra-id", { callbackUrl: `/${locale}` });
  }

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {t("login")}
      </Title>

      {showCredentials && (
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="email"
            label={t("email")}
            rules={[{ required: true, type: "email" }]}
          >
            <Input
              prefix={<MailOutlined />}
              size="large"
              type="email"
              autoComplete="email"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("password")}
            rules={[{ required: true, min: 8 }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>
          <div style={{ textAlign: "right", marginBottom: 16 }}>
            <Link href={`/${locale}/forgot-password`}>
              {t("forgotPasswordLink")}
            </Link>
          </div>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              {t("signIn")}
            </Button>
          </Form.Item>
        </Form>
      )}

      {ssoConfigured && (
        <>
          {showCredentials && <Divider plain>{t("or")}</Divider>}
          <Button
            icon={<WindowsOutlined />}
            onClick={onSso}
            loading={ssoLoading}
            block
            size="large"
            // Primary when it's the only option, default when it sits beside the form.
            type={showCredentials ? "default" : "primary"}
          >
            {t("signInWithMicrosoft")}
          </Button>
          {!showCredentials && (
            <Typography.Paragraph
              type="secondary"
              style={{ textAlign: "center", marginTop: 16, marginBottom: 0 }}
            >
              {t("ssoOnlyHint")}
            </Typography.Paragraph>
          )}
        </>
      )}
    </Card>
  );
}
