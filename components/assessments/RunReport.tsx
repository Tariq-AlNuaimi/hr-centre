"use client";

import {
  Card,
  Tag,
  Typography,
  Progress,
  Space,
  Table,
  Alert,
  Empty,
  Divider,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";
import { dimensionLabel } from "@/lib/testing/dimensions";

const { Title, Paragraph, Text } = Typography;

export interface ReportFinding {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  recommendation: string | null;
  evidence: string | null;
}

export interface ReportDimensionResult {
  id: string;
  dimension: string;
  score: number | null;
  status: "PASS" | "WARN" | "FAIL";
  summary: string;
  findings: ReportFinding[];
}

export interface ReportRequirement {
  id: string;
  requirement: string;
  status: "MET" | "PARTIAL" | "MISSING";
  evidence: string | null;
}

export interface ReportRun {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  overallScore: number | null;
  summary: string | null;
  error: string | null;
  finalUrl: string | null;
  dimensionResults: ReportDimensionResult[];
  requirements: ReportRequirement[];
}

const SEVERITY_COLOR: Record<ReportFinding["severity"], string> = {
  CRITICAL: "red",
  HIGH: "volcano",
  MEDIUM: "orange",
  LOW: "gold",
  INFO: "blue",
};

const RESULT_COLOR: Record<ReportDimensionResult["status"], string> = {
  PASS: "green",
  WARN: "orange",
  FAIL: "red",
};

const COVERAGE_COLOR: Record<ReportRequirement["status"], string> = {
  MET: "green",
  PARTIAL: "orange",
  MISSING: "red",
};

// Score → semantic theme token (not a raw hex): adapts to dark mode and stays
// on-palette. token comes from theme.useToken() at the call site.
type ScoreTokens = Pick<
  ReturnType<typeof theme.useToken>["token"],
  "colorSuccess" | "colorWarning" | "colorError" | "colorTextTertiary"
>;

function scoreColor(score: number | null, token: ScoreTokens): string {
  if (score == null) return token.colorTextTertiary;
  if (score >= 70) return token.colorSuccess;
  if (score >= 50) return token.colorWarning;
  return token.colorError;
}

export function RunReport({ run }: { run: ReportRun }) {
  const t = useTranslations("assessments");
  const { token } = theme.useToken();

  if (run.status === "FAILED") {
    return (
      <Alert
        type="error"
        showIcon
        message={t("runFailed")}
        description={run.error ?? t("runFailedGeneric")}
      />
    );
  }

  if (run.status !== "COMPLETED") {
    return <Alert type="info" showIcon message={t("runInProgress")} />;
  }

  const findingColumns: ColumnsType<ReportFinding> = [
    {
      title: t("severity"),
      dataIndex: "severity",
      width: 110,
      render: (s: ReportFinding["severity"]) => <Tag color={SEVERITY_COLOR[s]}>{s}</Tag>,
    },
    {
      title: t("finding"),
      dataIndex: "title",
      render: (_: string, row: ReportFinding) => (
        <div>
          <Text strong>{row.title}</Text>
          <Paragraph style={{ marginBottom: 4 }}>{row.detail}</Paragraph>
          {row.recommendation && (
            <Paragraph type="secondary" style={{ marginBottom: 2 }}>
              <Text strong>{t("recommendation")}: </Text>
              {row.recommendation}
            </Paragraph>
          )}
          {row.evidence && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("evidence")}: {row.evidence}
            </Text>
          )}
        </div>
      ),
    },
  ];

  const coverage = run.requirements;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Space size="large" align="center" wrap>
          <Progress
            type="dashboard"
            percent={run.overallScore ?? 0}
            size={120}
            strokeColor={scoreColor(run.overallScore, token)}
            format={(p) => `${p}`}
          />
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
              {t("overallScore")}
            </Title>
            <Paragraph style={{ marginBottom: 4 }}>{run.summary}</Paragraph>
            {run.finalUrl && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("testedUrl")}: {run.finalUrl}
              </Text>
            )}
          </div>
        </Space>
      </Card>

      {run.dimensionResults.map((dr) => (
        <Card
          key={dr.id}
          title={
            <Space>
              <span>{dimensionLabel(dr.dimension as never)}</span>
              <Tag color={RESULT_COLOR[dr.status]}>{dr.status}</Tag>
              <Tag color={scoreColor(dr.score, token)}>{dr.score ?? "-"}/100</Tag>
            </Space>
          }
        >
          <Paragraph>{dr.summary}</Paragraph>

          {dr.dimension === "BRD_COVERAGE" && coverage.length > 0 && (
            <>
              <Divider plain>{t("requirementCoverage")}</Divider>
              <Space direction="vertical" style={{ width: "100%" }} size={4}>
                {coverage.map((req) => (
                  <div key={req.id}>
                    <Tag color={COVERAGE_COLOR[req.status]}>{req.status}</Tag>
                    <Text>{req.requirement}</Text>
                    {req.evidence && (
                      <Text type="secondary" style={{ fontSize: 12, display: "block", marginInlineStart: 8 }}>
                        {req.evidence}
                      </Text>
                    )}
                  </div>
                ))}
              </Space>
              {dr.findings.length > 0 && <Divider plain>{t("findings")}</Divider>}
            </>
          )}

          {dr.findings.length > 0 ? (
            <Table<ReportFinding>
              rowKey="id"
              columns={findingColumns}
              dataSource={dr.findings}
              pagination={false}
              size="small"
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("noFindings")} />
          )}
        </Card>
      ))}
    </Space>
  );
}
