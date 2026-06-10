"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Button, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";

const { Title } = Typography;

interface LatestRun {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  overallScore: number | null;
  createdAt: string;
}

interface AssessmentRow {
  id: string;
  name: string;
  targetUrl: string;
  dimensions: string[];
  createdAt: string;
  _count: { runs: number };
  runs: LatestRun[];
}

const RUN_STATUS_COLOR: Record<LatestRun["status"], string> = {
  PENDING: "default",
  RUNNING: "processing",
  COMPLETED: "green",
  FAILED: "red",
};

export default function AssessmentsPage() {
  const t = useTranslations("assessments");
  const router = useRouter();
  const locale = useLocale();
  const { error: showError } = useNotify();
  const { list, listLoading } = useCrud<AssessmentRow>({ basePath: "/api/assessments" });

  const [rows, setRows] = useState<AssessmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  const fetchRows = useCallback(async () => {
    try {
      const result = await list({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
      });
      setRows(result.data as unknown as AssessmentRow[]);
      setTotal(result.total);
    } catch {
      showError(t("loadFailed"));
    }
  }, [page, pageSize, search, list, showError, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows();
  }, [fetchRows]);

  const columns: ColumnsType<AssessmentRow> = [
    {
      title: t("name"),
      dataIndex: "name",
      render: (name: string, row) => (
        <a onClick={() => router.push(`/${locale}/assessments/${row.id}`)}>{name}</a>
      ),
    },
    { title: t("targetUrl"), dataIndex: "targetUrl", ellipsis: true },
    {
      title: t("dimensions"),
      dataIndex: "dimensions",
      render: (dims: string[]) => `${dims.length}`,
      width: 110,
    },
    {
      title: t("lastRun"),
      key: "lastRun",
      width: 180,
      render: (_, row) => {
        const last = row.runs[0];
        if (!last) return <Tag>{t("noRuns")}</Tag>;
        return (
          <Space>
            <Tag color={RUN_STATUS_COLOR[last.status]}>{last.status}</Tag>
            {last.status === "COMPLETED" && last.overallScore != null && (
              <span>{last.overallScore}/100</span>
            )}
          </Space>
        );
      },
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      width: 130,
      render: (v: string) => new Date(v).toLocaleDateString(),
    },
  ];

  return (
    <>
      <Space style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>
          {t("title")}
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => router.push(`/${locale}/assessments/new`)}
        >
          {t("newAssessment")}
        </Button>
      </Space>

      <DataTable<AssessmentRow>
        columns={columns}
        dataSource={rows}
        loading={listLoading}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => {
          setPage(p);
          setPageSize(ps);
        }}
        searchable
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        emptyText={
          <EmptyState
            description={t("emptyDescription")}
            actionLabel={t("newAssessment")}
            onAction={() => router.push(`/${locale}/assessments/new`)}
          />
        }
      />
    </>
  );
}
