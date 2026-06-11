"use client";

import { useState } from "react";
import { Form, Input, Button, Checkbox, Space, Upload, Typography, Segmented, Card, Divider } from "antd";
import { UploadOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { DIMENSION_ORDER, DIMENSION_META } from "@/lib/testing/dimensions";

const { TextArea } = Input;
const { Text } = Typography;

export interface CredentialValue {
  role: string;
  username?: string;
  password?: string;
  cookie?: string;
}

export interface AssessmentFormValues {
  name: string;
  targetUrl: string;
  brdText: string;
  dimensions: string[];
  authMode?: "NONE" | "FORM" | "COOKIE";
  loginUrl?: string;
  credentials?: CredentialValue[];
}

interface AssessmentFormProps {
  initialValues?: Partial<AssessmentFormValues>;
  onSubmit: (values: AssessmentFormValues) => Promise<void> | void;
  onCancel: () => void;
  loading?: boolean;
  submitLabel: string;
}

const dimensionOptions = DIMENSION_ORDER.map((d) => ({
  label: `${DIMENSION_META[d].label}${DIMENSION_META[d].advisory ? " (advisory)" : ""}`,
  value: d,
}));

export function AssessmentForm({
  initialValues,
  onSubmit,
  onCancel,
  loading,
  submitLabel,
}: AssessmentFormProps) {
  const t = useTranslations("assessments");
  const { error: showError, success } = useNotify();
  const [form] = Form.useForm<AssessmentFormValues>();
  const [parsing, setParsing] = useState(false);
  const authMode = Form.useWatch("authMode", form) ?? "NONE";

  // Read .txt/.md directly; send PDF to the server for Claude-based extraction.
  const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    try {
      setParsing(true);
      if (isPdf) {
        const base64 = await fileToBase64(file);
        const { text } = await apiClient.post<{ text: string }>("/api/assessments/parse-brd", {
          base64,
          mediaType: "application/pdf",
        });
        form.setFieldsValue({ brdText: text });
      } else {
        const text = await file.text();
        form.setFieldsValue({ brdText: text });
      }
      success(t("brdLoaded"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("brdParseFailed"));
    } finally {
      setParsing(false);
    }
    return false; // prevent antd's default upload
  };

  return (
    <Form<AssessmentFormValues>
      form={form}
      layout="vertical"
      initialValues={{ dimensions: DIMENSION_ORDER as unknown as string[], ...initialValues }}
      onFinish={onSubmit}
      style={{ maxWidth: 720 }}
    >
      <Form.Item
        name="name"
        label={t("name")}
        rules={[{ required: true, message: t("nameRequired") }]}
      >
        <Input placeholder={t("namePlaceholder")} />
      </Form.Item>

      <Form.Item
        name="targetUrl"
        label={t("targetUrl")}
        rules={[{ required: true, message: t("urlRequired") }]}
      >
        <Input placeholder="https://example.com" />
      </Form.Item>

      <Form.Item
        name="dimensions"
        label={t("dimensions")}
        rules={[{ required: true, message: t("dimensionsRequired") }]}
      >
        <Checkbox.Group options={dimensionOptions} />
      </Form.Item>

      <Form.Item
        name="brdText"
        label={t("brd")}
        extra={t("brdHint")}
      >
        <TextArea rows={10} placeholder={t("brdPlaceholder")} />
      </Form.Item>

      <Form.Item>
        <Space direction="vertical" size="small">
          <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".pdf,.txt,.md,.markdown">
            <Button icon={<UploadOutlined />} loading={parsing}>
              {t("uploadBrd")}
            </Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("uploadHint")}
          </Text>
        </Space>
      </Form.Item>

      <Divider />

      <Form.Item name="authMode" label={t("authentication")} initialValue="NONE" extra={t("authHint")}>
        <Segmented
          options={[
            { label: t("authNone"), value: "NONE" },
            { label: t("authForm"), value: "FORM" },
            { label: t("authCookie"), value: "COOKIE" },
          ]}
        />
      </Form.Item>

      {authMode === "FORM" && (
        <Form.Item
          name="loginUrl"
          label={t("loginUrl")}
          extra={t("loginUrlHint")}
          rules={[{ required: true, message: t("loginUrlRequired") }]}
        >
          <Input placeholder="https://example.com/login" />
        </Form.Item>
      )}

      {authMode !== "NONE" && (
        <Form.List name="credentials">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size="middle" style={{ display: "flex" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {authMode === "FORM" ? t("rolesFormHint") : t("rolesCookieHint")}
              </Text>
              {fields.map((field) => (
                <Card key={field.key} size="small">
                  <Space align="baseline" wrap style={{ width: "100%" }}>
                    <Form.Item
                      name={[field.name, "role"]}
                      rules={[{ required: true, message: t("roleRequired") }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder={t("rolePlaceholder")} style={{ width: 140 }} />
                    </Form.Item>
                    {authMode === "FORM" ? (
                      <>
                        <Form.Item name={[field.name, "username"]} style={{ marginBottom: 0 }}>
                          <Input placeholder={t("username")} style={{ width: 200 }} />
                        </Form.Item>
                        <Form.Item name={[field.name, "password"]} style={{ marginBottom: 0 }}>
                          <Input.Password placeholder={t("password")} style={{ width: 200 }} autoComplete="new-password" />
                        </Form.Item>
                      </>
                    ) : (
                      <Form.Item name={[field.name, "cookie"]} style={{ marginBottom: 0 }}>
                        <Input.Password
                          placeholder="session=…; token=…"
                          style={{ width: 360 }}
                          autoComplete="new-password"
                        />
                      </Form.Item>
                    )}
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                </Card>
              ))}
              <Button type="dashed" onClick={() => add({ role: "" })} icon={<PlusOutlined />} block>
                {t("addRole")}
              </Button>
            </Space>
          )}
        </Form.List>
      )}

      <Form.Item style={{ marginTop: 24 }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            {submitLabel}
          </Button>
          <Button onClick={onCancel}>{t("cancel")}</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // strip the "data:...;base64," prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
