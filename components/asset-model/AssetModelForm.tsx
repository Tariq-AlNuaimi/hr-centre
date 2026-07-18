"use client";

import { z } from "zod";
import { useTranslations } from "next-intl";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { RelationSelect } from "@/components/shared/RelationSelect";

interface AssetModelFormProps {
  initialValues?: Partial<{ name: string; categoryId: string; manufacturerId: string }>;
  onSubmit: (values: { name: string; categoryId: string; manufacturerId: string }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function AssetModelForm({
  initialValues,
  onSubmit,
  onCancel,
  loading = false,
}: AssetModelFormProps) {
  const t = useTranslations("assetModels");

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
    name: z.string().min(1),
    categoryId: z.string().min(1),
    manufacturerId: z.string().min(1),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      name: initialValues?.name ?? "",
      categoryId: initialValues?.categoryId ?? undefined,
      manufacturerId: initialValues?.manufacturerId ?? undefined,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
        <TextField name="name" label={t("name")} />

        <FormField
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("category")}</FormLabel>
              <RelationSelect
                path="/api/category"
                displayField="name"
                placeholder={t("category")}
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
          name="manufacturerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("manufacturer")}</FormLabel>
              <RelationSelect
                path="/api/manufacturer"
                displayField="name"
                placeholder={t("manufacturer")}
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
