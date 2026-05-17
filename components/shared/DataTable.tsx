"use client";

import { Table, Input, Space } from "antd";
import type { TableProps, TablePaginationConfig } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface DataTableProps<T> extends Omit<TableProps<T>, "pagination"> {
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  searchable?: boolean;
  onSearch?: (value: string) => void;
}

export function DataTable<T extends object>({
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
  searchable = false,
  onSearch,
  ...tableProps
}: DataTableProps<T>) {
  const t = useTranslations("common");
  const [searchValue, setSearchValue] = useState("");

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`,
    onChange: onPageChange,
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {searchable && (
        <Input
          prefix={<SearchOutlined />}
          placeholder={t("search")}
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value);
            onSearch?.(e.target.value);
          }}
          allowClear
          style={{ maxWidth: 400 }}
        />
      )}
      <Table<T>
        pagination={pagination}
        rowKey="id"
        locale={{ emptyText: t("noData") }}
        {...tableProps}
      />
    </Space>
  );
}
