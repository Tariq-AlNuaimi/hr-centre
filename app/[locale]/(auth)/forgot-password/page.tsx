"use client";

import { Card, Form, Input, Button, Typography, App } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useState } from "react";

const { Title, Paragraph } = Typography;

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onFinish(values: { email: string }) {
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      // Always show the same neutral message regardless of outcome so we don't
      // leak which emails exist. The API mirrors this behaviour.
      setSubmitted(true);
    } catch {
      // TODO i18n: generic error copy
      message.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {/* TODO i18n: dedicated key for "Forgot password" */}
        Forgot password
      </Title>

      {submitted ? (
        <>
          <Paragraph style={{ textAlign: "center" }}>
            {/* TODO i18n: dedicated key for the neutral confirmation copy */}
            If that email exists, a reset link was sent.
          </Paragraph>
          <Button block size="large">
            <Link href={`/${locale}/login`}>{t("login")}</Link>
          </Button>
        </>
      ) : (
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
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              {/* TODO i18n: dedicated key for "Send reset link" */}
              Send reset link
            </Button>
          </Form.Item>
          <div style={{ textAlign: "center" }}>
            <Link href={`/${locale}/login`}>{t("login")}</Link>
          </div>
        </Form>
      )}
    </Card>
  );
}
