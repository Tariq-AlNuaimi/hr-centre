"use client";

import { useState } from "react";
import { Typography, Card, Descriptions, Spin, Form, Input, Button, Divider } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useNotify } from "@/hooks/use-notify";

export default function ProfilePage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const { success, error: showError } = useNotify();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  if (status === "loading") return <Spin size="large" />;

  const user = session?.user;

  async function onChangePassword(values: {
    currentPassword: string;
    newPassword: string;
  }) {
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${user?.id}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) {
        showError(json.error ?? "Failed to change password");
        return;
      }
      success(t("passwordChanged"));
      form.resetFields();
    } catch {
      showError("Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Typography.Title level={2}>{t("profile")}</Typography.Title>
      <Card>
        <Descriptions column={1} bordered>
          <Descriptions.Item label={t("name")}>
            {user?.name ?? "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("email")}>
            {user?.email ?? "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("role")}>
            {user?.role ?? "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Divider />

      <Card title={t("changePassword")}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onChangePassword}
          style={{ maxWidth: 400 }}
        >
          <Form.Item
            name="currentPassword"
            label={t("currentPassword")}
            rules={[{ required: true }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t("newPassword")}
            rules={[{ required: true, min: 6 }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t("confirmPassword")}
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t("passwordMismatch")));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              {tCommon("save")}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
