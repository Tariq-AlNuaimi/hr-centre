"use client";

import { Home } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useBreadcrumb } from "./BreadcrumbProvider";
import { localePrefixRegex } from "@/i18n/config";
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
  const segments = pathname.replace(localePrefixRegex, "").split("/").filter(Boolean);

  type Crumb = { key: string; node: React.ReactNode; isLast: boolean };

  const items: Crumb[] = [
    {
      key: "__home",
      node: (
        <Link
          href={`/${locale}`}
          className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("home")}
        >
          <Home className="h-4 w-4" />
        </Link>
      ),
      isLast: segments.length === 0,
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
        key: `${segment}-${index}`,
        node: isLast ? (
          <span className="text-foreground">{label}</span>
        ) : (
          <Link
            href={path}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {label}
          </Link>
        ),
        isLast,
      };
    }),
  ];

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {items.map((item, index) => (
          <li key={item.key} className="inline-flex items-center gap-2">
            {index > 0 && (
              <span aria-hidden className="text-muted-foreground select-none">
                /
              </span>
            )}
            {item.isLast ? <span aria-current="page">{item.node}</span> : item.node}
          </li>
        ))}
      </ol>
    </nav>
  );
}
