"use client";

import { Card, Form, Input, Button, Typography, App } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

const { Title } = Typography;

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const pathname = usePathname();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const locale = pathname.startsWith("/ar") ? "ar" : "en";

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
      <Form layout="vertical" onFinish={onFinish} autoComplete="off">
        <Form.Item
          name="email"
          label={t("email")}
          rules={[{ required: true, type: "email" }]}
        >
          <Input prefix={<MailOutlined />} size="large" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t("password")}
          rules={[{ required: true, min: 6 }]}
        >
          <Input.Password prefix={<LockOutlined />} size="large" />
        </Form.Item>
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
