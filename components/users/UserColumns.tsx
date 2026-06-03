"use client";

import { Button, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { ConfirmAction } from "@/components/shared/ConfirmAction";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const roleColors: Record<string, string> = {
  ADMIN: "red",
  EDITOR: "blue",
  VIEWER: "default",
};

export function getUserColumns({
  onEdit,
  onDelete,
  t,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}): ColumnsType<UserRecord> {
  return [
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      sorter: true,
    },
    {
      title: t("email"),
      dataIndex: "email",
      key: "email",
      sorter: true,
    },
    {
      title: t("role"),
      dataIndex: "role",
      key: "role",
      render: (role: string) => (
        <Tag color={roleColors[role] ?? "default"}>{role}</Tag>
      ),
      filters: [
        { text: t("roleAdmin"), value: "ADMIN" },
        { text: t("roleEditor"), value: "EDITOR" },
        { text: t("roleViewer"), value: "VIEWER" },
      ],
      filterMultiple: false,
    },
    {
      title: t("lastLogin"),
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      render: (val: string | null) =>
        val ? new Date(val).toLocaleDateString() : "-",
      sorter: true,
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_: unknown, record: UserRecord) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            aria-label={t("editAction")}
            onClick={() => onEdit(record.id)}
          />
          <ConfirmAction
            title={t("deleteConfirm")}
            onConfirm={() => onDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("deleteAction")}
            />
          </ConfirmAction>
        </Space>
      ),
    },
  ];
}
