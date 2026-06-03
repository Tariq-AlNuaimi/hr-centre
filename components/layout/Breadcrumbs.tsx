"use client";

import { Breadcrumb } from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useBreadcrumb } from "./BreadcrumbProvider";
import Link from "next/link";

const segmentToNavKey: Record<string, string> = {
  users: "users",
  "audit-log": "auditLog",
  settings: "settings",
  profile: "profile",
  "recycling-bin": "recyclingBin",
  new: "create",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const { dynamicLabels } = useBreadcrumb();
  const locale = useLocale();

  // Strip locale prefix: /en/users/123 -> ['users', '123']
  const segments = pathname
    .replace(/^\/(en|ar)/, "")
    .split("/")
    .filter(Boolean);

  const items = [
    {
      title: (
        <Link href={`/${locale}`}>
          <HomeOutlined />
        </Link>
      ),
    },
    ...segments.map((segment, index) => {
      const path = `/${locale}/` + segments.slice(0, index + 1).join("/");
      const navKey = segmentToNavKey[segment];
      let label: string;

      if (dynamicLabels[segment]) {
        label = dynamicLabels[segment];
      } else if (navKey) {
        // Try nav translations first, fall back to common
        try {
          label = t(navKey);
        } catch {
          try {
            label = tCommon(navKey);
          } catch {
            label = segment;
          }
        }
      } else {
        label = segment;
      }

      const isLast = index === segments.length - 1;

      return {
        title: isLast ? label : <Link href={path}>{label}</Link>,
      };
    }),
  ];

  return <Breadcrumb items={items} style={{ marginBottom: 16 }} />;
}
