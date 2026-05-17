"use client";

import { Skeleton, Space } from "antd";

export default function UsersLoading() {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton.Input active style={{ width: 150, height: 32 }} />
        <Skeleton.Button active style={{ width: 120 }} />
      </div>
      <Skeleton active paragraph={{ rows: 8 }} />
    </Space>
  );
}
