"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Form, Input, Button, Space, Typography, Alert, Tag, Spin } from "antd";
import { ApiOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";

const { Paragraph, Text, Link } = Typography;

interface BrowserSettings {
  projectId: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  source: "db" | "env";
}

interface FormValues {
  projectId: string;
  apiKey?: string;
}

export function BrowserEngineSettings() {
  const t = useTranslations("settings");
  const { success, error: showError } = useNotify();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<BrowserSettings | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<BrowserSettings>("/api/settings/browser-engine");
      setCurrent(data);
      form.setFieldsValue({ projectId: data.projectId ?? "", apiKey: "" });
    } catch {
      showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [form, showError, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (values: FormValues) => {
    setSaving(true);
    try {
      const payload: FormValues = {
        projectId: values.projectId,
        ...(values.apiKey && values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
      };
      const updated = await apiClient.put<BrowserSettings>("/api/settings/browser-engine", payload);
      setCurrent(updated);
      form.setFieldValue("apiKey", "");
      success(t("saved"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  return (
    <Card title={t("browserEngineTitle")}>
      <Paragraph type="secondary">
        {t("browserEngineIntro")}{" "}
        <Link href="https://www.browserbase.com" target="_blank" rel="noopener noreferrer">
          browserbase.com
        </Link>
      </Paragraph>

      {current?.hasApiKey && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 16 }}
          message={
            <span>
              {t("apiKeyConfigured")} <Text code>{current.apiKeyMasked}</Text>
              {current.source === "env" && <Tag style={{ marginInlineStart: 8 }}>env</Tag>}
            </span>
          }
        />
      )}

      <Form<FormValues> form={form} layout="vertical" onFinish={handleSave} style={{ maxWidth: 720 }}>
        <Form.Item
          name="projectId"
          label={t("browserbaseProjectId")}
          rules={[{ required: true, message: t("browserbaseProjectIdRequired") }]}
        >
          <Input placeholder="bb_proj_..." />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              {t("browserbaseApiKey")}
              {current?.hasApiKey && <Tag color="green">{t("apiKeyConfiguredTag")}</Tag>}
            </Space>
          }
          name="apiKey"
          extra={t("apiKeyKeepBlank")}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={current?.hasApiKey ? current.apiKeyMasked ?? "" : t("apiKeyPlaceholder")}
            prefix={<ApiOutlined />}
          />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={saving}>
          {t("save")}
        </Button>
      </Form>
    </Card>
  );
}
