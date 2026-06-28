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
      message.error(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {t("forgotPassword")}
      </Title>

      {submitted ? (
        <>
          <Paragraph style={{ textAlign: "center" }}>
            {t("resetLinkSent")}
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
              {t("sendResetLink")}
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
