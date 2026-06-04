"use client";

import { Card, Form, Input, Button, Typography, App } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";

const { Title, Paragraph } = Typography;

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
          {/* TODO i18n: dedicated key for "Reset password" */}
          Reset password
        </Title>
        <Paragraph style={{ textAlign: "center" }}>
          {/* TODO i18n: dedicated key for the missing/invalid token copy */}
          This reset link is invalid or has expired.
        </Paragraph>
        <Button block size="large">
          <Link href={`/${locale}/forgot-password`}>
            {/* TODO i18n: dedicated key for "Request a new link" */}
            Request a new link
          </Link>
        </Button>
      </Card>
    );
  }

  async function onFinish(values: {
    newPassword: string;
    confirmPassword: string;
  }) {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: values.newPassword }),
      });
      if (!res.ok) {
        // Surface the API's specific reason (e.g. "invalid or expired") rather
        // than a generic catch-all, so the user can tell expiry from a network error.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "");
      }
      // TODO i18n: dedicated key for the success toast
      message.success("Your password has been reset. Please sign in.");
      router.push(`/${locale}/login`);
    } catch (e) {
      // TODO i18n: dedicated key for the failure toast
      message.error(
        (e as Error).message || "Could not reset your password. The link may have expired."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {/* TODO i18n: dedicated key for "Reset password" */}
        Reset password
      </Title>
      <Form layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="newPassword"
          label={t("password")}
          rules={[{ required: true, min: 8 }]}
          hasFeedback
        >
          <Input.Password
            prefix={<LockOutlined />}
            size="large"
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          // TODO i18n: dedicated key for "Confirm password"
          label="Confirm password"
          dependencies={["newPassword"]}
          hasFeedback
          rules={[
            { required: true, min: 8 },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                // TODO i18n: dedicated key for the mismatch message
                return Promise.reject(new Error("Passwords do not match"));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            size="large"
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
          >
            {/* TODO i18n: dedicated key for "Reset password" */}
            Reset password
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
