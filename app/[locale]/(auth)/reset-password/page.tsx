"use client";

import { Card, Form, Input, Button, Typography, App } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import { apiClient } from "@/lib/api-client";

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
          {t("resetPassword")}
        </Title>
        <Paragraph style={{ textAlign: "center" }}>
          {t("resetInvalidOrExpired")}
        </Paragraph>
        <Button block size="large">
          <Link href={`/${locale}/forgot-password`}>
            {t("requestNewLink")}
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
      // apiClient throws ApiError carrying the server's `error` message on a
      // non-2xx, so the user can tell expiry from a network error; an empty
      // message falls back to the generic copy below.
      await apiClient.post("/api/auth/reset-password", {
        token,
        newPassword: values.newPassword,
      });
      message.success(t("resetSuccess"));
      router.push(`/${locale}/login`);
    } catch (e) {
      message.error((e as Error).message || t("resetFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {t("resetPassword")}
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
          label={t("confirmPassword")}
          dependencies={["newPassword"]}
          hasFeedback
          rules={[
            { required: true, min: 8 },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t("passwordsMustMatch")));
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
            {t("resetPassword")}
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
