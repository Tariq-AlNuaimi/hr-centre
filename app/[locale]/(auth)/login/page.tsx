"use client";

import { Card, Form, Input, Button, Typography, App } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

const { Title } = Typography;

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

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

  return (
    <Card style={{ width: 400, maxWidth: "100%" }}>
      <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
        {t("login")}
      </Title>
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
    </Card>
  );
}
