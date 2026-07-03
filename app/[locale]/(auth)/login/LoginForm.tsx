"use client";

import { Card, Typography, Divider, App } from "antd";
import { WindowsOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";

const { Title } = Typography;

// Mirrors the credentials the Auth.js `credentials` provider expects (email +
// a >=8-char password). Login has no API-route schema of its own (sign-in goes
// through next-auth), so this local schema is the client-side contract.
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type LoginValues = z.infer<typeof loginSchema>;

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

  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  // When SSO is enforced, credentials are removed from the provider list
  // (lib/auth), so the password form is hidden and SSO is the only way in.
  const showCredentials = !(ssoConfigured && ssoEnforced);

  async function onSubmit(values: LoginValues) {
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
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <TextField
              name="email"
              label={t("email")}
              type="email"
              autoComplete="email"
            />
            <TextField
              name="password"
              label={t("password")}
              type="password"
              autoComplete="current-password"
            />
            <div className="-mt-1 text-end">
              <Link href={`/${locale}/forgot-password`}>
                {t("forgotPasswordLink")}
              </Link>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {t("signIn")}
            </Button>
          </form>
        </Form>
      )}

      {ssoConfigured && (
        <>
          {showCredentials && <Divider plain>{t("or")}</Divider>}
          <Button
            type="button"
            onClick={onSso}
            disabled={ssoLoading}
            size="lg"
            className="w-full"
            // Primary when it's the only option, outline when it sits beside the form.
            variant={showCredentials ? "outline" : "default"}
          >
            <WindowsOutlined />
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
