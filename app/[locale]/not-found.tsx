"use client";

import { Result, Button } from "antd";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("notFound");
  const tCommon = useTranslations("common");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}
    >
      <Result
        status="404"
        title="404"
        subTitle={t("subtitle")}
        extra={
          <Link href="/">
            <Button type="primary">{tCommon("backHome")}</Button>
          </Link>
        }
      />
    </div>
  );
}
