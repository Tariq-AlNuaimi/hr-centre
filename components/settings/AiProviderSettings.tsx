"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Form,
  Input,
  Button,
  Segmented,
  Space,
  Typography,
  Alert,
  Tag,
  Spin,
} from "antd";
import { ThunderboltOutlined, ApiOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";

const { Text, Paragraph } = Typography;

interface Preset {
  id: string;
  label: string;
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE";
  baseUrl: string | null;
  model: string;
}

interface ProviderSettings {
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE";
  baseUrl: string | null;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  source: "db" | "env";
  presets: Preset[];
}

interface FormValues {
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE";
  baseUrl?: string;
  model: string;
  apiKey?: string;
}

export function AiProviderSettings() {
  const t = useTranslations("settings");
  const { success, error: showError } = useNotify();
  const [form] = Form.useForm<FormValues>();
  const provider = Form.useWatch("provider", form);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [current, setCurrent] = useState<ProviderSettings | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<ProviderSettings>("/api/settings/ai-provider");
      setCurrent(data);
      setPresets(data.presets);
      form.setFieldsValue({
        provider: data.provider,
        baseUrl: data.baseUrl ?? "",
        model: data.model,
        apiKey: "",
      });
    } catch {
      showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [form, showError, t]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (p: Preset) => {
    form.setFieldsValue({
      provider: p.provider,
      baseUrl: p.baseUrl ?? "",
      model: p.model,
    });
  };

  const handleSave = async (values: FormValues) => {
    setSaving(true);
    try {
      const payload: FormValues = {
        provider: values.provider,
        model: values.model,
        baseUrl: values.provider === "OPENAI_COMPATIBLE" ? values.baseUrl : "",
        // Only send a key if the operator typed one; blank keeps the existing.
        ...(values.apiKey && values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
      };
      const updated = await apiClient.put<ProviderSettings>("/api/settings/ai-provider", payload);
      setCurrent(updated);
      form.setFieldValue("apiKey", "");
      success(t("saved"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // Test what's currently in the form (so a freshly-typed, unsaved key is
      // exercised); a blank key falls back to the stored one server-side.
      const v = form.getFieldsValue();
      const payload: FormValues = {
        provider: v.provider,
        model: v.model,
        baseUrl: v.provider === "OPENAI_COMPATIBLE" ? v.baseUrl : "",
        ...(v.apiKey && v.apiKey.trim() ? { apiKey: v.apiKey.trim() } : {}),
      };
      const res = await apiClient.post<{ ok: boolean; provider: string; model: string }>(
        "/api/settings/ai-provider/test",
        payload
      );
      success(`${t("testOk")} — ${res.model}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("testFailed"));
    } finally {
      setTesting(false);
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
    <Card title={t("aiProviderTitle")}>
      <Paragraph type="secondary">{t("aiProviderIntro")}</Paragraph>

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

      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
          {t("quickPreset")}
        </Text>
        <Space wrap>
          {presets.map((p) => (
            <Button key={p.id} onClick={() => applyPreset(p)}>
              {p.label}
            </Button>
          ))}
        </Space>
      </div>

      <Form<FormValues> form={form} layout="vertical" onFinish={handleSave} style={{ maxWidth: 720 }}>
        <Form.Item name="provider" label={t("provider")} rules={[{ required: true }]}>
          <Segmented
            options={[
              { label: `${t("providerAnthropic")} · ${t("providerAnthropicSub")}`, value: "ANTHROPIC" },
              { label: `${t("providerOpenAI")} · ${t("providerOpenAISub")}`, value: "OPENAI_COMPATIBLE" },
            ]}
          />
        </Form.Item>

        {provider === "OPENAI_COMPATIBLE" && (
          <Form.Item
            name="baseUrl"
            label={t("baseUrl")}
            extra={t("baseUrlHint")}
            rules={[{ required: true, message: t("baseUrlRequired") }]}
          >
            <Input placeholder="https://litellm.rihal.dev/" />
          </Form.Item>
        )}

        <Form.Item name="model" label={t("model")} rules={[{ required: true, message: t("modelRequired") }]}>
          <Input placeholder="claude-opus-4-8" />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              {t("apiKey")}
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

        {provider === "OPENAI_COMPATIBLE" && (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("visionNote")} />
        )}

        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t("save")}
          </Button>
          <Button icon={<ThunderboltOutlined />} loading={testing} onClick={handleTest}>
            {t("testConnection")}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
