"use client";

import { Skeleton, Space } from "antd";

export default function DashboardLoading() {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Skeleton.Input active style={{ width: 200, height: 32 }} />
      <Skeleton active paragraph={{ rows: 6 }} />
    </Space>
  );
}
