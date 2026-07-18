"use client";

import { z } from "zod";
import { useTranslations } from "next-intl";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RelationSelect } from "@/components/shared/RelationSelect";
import { assetStatusLabel, assetCategoryLabel } from "@/components/asset/asset-labels";

interface AssetFormProps {
  initialValues?: Partial<{
    assetTag: string;
    name: string;
    serial?: string | null;
    purchasedAt?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    modelId?: string | null;
    assigneeId?: string | null;
  }>;
  onSubmit: (values: {
    assetTag: string;
    name: string;
    serial?: string | null;
    purchasedAt?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    modelId?: string | null;
    assigneeId?: string | null;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function AssetForm({ initialValues, onSubmit, onCancel, loading = false }: AssetFormProps) {
  const t = useTranslations("assets");

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
    assetTag: z.string().min(1),
    name: z.string().min(1),
    serial: z.string().nullish(),
    purchasedAt: z.string().nullish(),
    status: z.enum(["IN_STOCK", "ASSIGNED", "REPAIR", "RETIRED"]),
    category: z.enum(["LAPTOP", "MONITOR", "PHONE", "OTHER"]),
    modelId: z.string().nullish(),
    assigneeId: z.string().nullish(),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      assetTag: initialValues?.assetTag ?? "",
      name: initialValues?.name ?? "",
      serial: initialValues?.serial ?? "",
      purchasedAt: initialValues?.purchasedAt ?? "",
      status: initialValues?.status ?? "IN_STOCK",
      category: initialValues?.category ?? "LAPTOP",
      modelId: initialValues?.modelId ?? undefined,
      assigneeId: initialValues?.assigneeId ?? undefined,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
        <TextField name="assetTag" label={t("assetTag")} />

        <TextField name="name" label={t("name")} />

        <TextField name="serial" label={t("serial")} />

        <TextField name="purchasedAt" label={t("purchasedAt")} type="date" />

        <FormField
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("status")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("status")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="IN_STOCK">{assetStatusLabel("IN_STOCK")}</SelectItem>
                  <SelectItem value="ASSIGNED">{assetStatusLabel("ASSIGNED")}</SelectItem>
                  <SelectItem value="REPAIR">{assetStatusLabel("REPAIR")}</SelectItem>
                  <SelectItem value="RETIRED">{assetStatusLabel("RETIRED")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("category")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("category")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="LAPTOP">{assetCategoryLabel("LAPTOP")}</SelectItem>
                  <SelectItem value="MONITOR">{assetCategoryLabel("MONITOR")}</SelectItem>
                  <SelectItem value="PHONE">{assetCategoryLabel("PHONE")}</SelectItem>
                  <SelectItem value="OTHER">{assetCategoryLabel("OTHER")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="modelId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("model")}</FormLabel>
              <RelationSelect
                path="/api/asset-model"
                displayField="name"
                placeholder={t("model")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={field.onChange}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="assigneeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("assignee")}</FormLabel>
              <RelationSelect
                path="/api/users"
                displayField="name"
                placeholder={t("assignee")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={field.onChange}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
