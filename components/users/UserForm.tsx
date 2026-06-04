"use client";

import { Form, Input, Select, Button, Space } from "antd";
import { useTranslations } from "next-intl";

interface UserFormProps {
  initialValues?: {
    email?: string;
    name?: string;
    role?: string;
  };
  onSubmit: (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
  isEdit?: boolean;
}

export function UserForm({
  initialValues,
  onSubmit,
  onCancel,
  loading = false,
  isEdit = false,
}: UserFormProps) {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");

  return (
    <Form
      layout="vertical"
      initialValues={initialValues ?? { role: "VIEWER" }}
      onFinish={onSubmit}
      style={{ maxWidth: 500 }}
    >
      <Form.Item
        name="name"
        label={t("name")}
        rules={[{ required: true, max: 255 }]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        name="email"
        label={t("email")}
        rules={[{ required: true, type: "email" }]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        name="password"
        label={t("password")}
        rules={[{ required: !isEdit, min: 8, max: 128 }]}
      >
        <Input.Password
          placeholder={isEdit ? t("passwordLeaveBlank") : undefined}
        />
      </Form.Item>

      <Form.Item name="role" label={t("role")} rules={[{ required: true }]}>
        <Select
          options={[
            { value: "ADMIN", label: t("roleAdmin") },
            { value: "EDITOR", label: t("roleEditor") },
            { value: "VIEWER", label: t("roleViewer") },
          ]}
        />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            {tCommon("save")}
          </Button>
          <Button onClick={onCancel}>{tCommon("cancel")}</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
