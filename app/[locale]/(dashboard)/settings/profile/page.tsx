"use client";

import { useState } from "react";
import { Card, Descriptions, Spin, Form, Input, Button, Divider } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

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
      await apiClient.put(`/api/users/${user?.id}/password`, values);
      success(t("passwordChanged"));
      form.resetFields();
    } catch (e) {
      // Surface the server's reason (carried by ApiError) on a non-2xx; fall
      // back to the generic copy for a network/parse failure.
      showError(e instanceof ApiError ? e.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title={t("profile")} />
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
            rules={[{ required: true, min: 8 }]}
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
