"use client";

import { useState } from "react";
import { z } from "zod";
import { useWatch } from "react-hook-form";
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
import { CustomFields } from "@/components/asset/CustomFields";
import { assetStatusLabel, assetCategoryLabel } from "@/components/asset/asset-labels";

interface AssetFormProps {
  initialValues?: Partial<{
    assetTag: string;
    name: string;
    serial?: string | null;
    location?: string | null;
    purchasedAt?: string | null;
    warrantyExpiresAt?: string | null;
    warrantyTerms?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    modelId?: string | null;
    assigneeId?: string | null;
    customFields?: Record<string, unknown> | null;
  }>;
  onSubmit: (values: {
    assetTag: string;
    name: string;
    serial?: string | null;
    location?: string | null;
    purchasedAt?: string | null;
    warrantyExpiresAt?: string | null;
    warrantyTerms?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    modelId?: string | null;
    assigneeId?: string | null;
    customFields?: Record<string, unknown>;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

// Module-level so the component body stays under the cyclomatic-complexity budget (ADR-034):
// the SAME shape guards the API route, and the many `?? default` branches for the initial
// values live here, not inside AssetForm.
const assetFormSchema = z.object({
  assetTag: z.string().min(1),
  name: z.string().min(1),
  serial: z.string().nullish(),
  location: z.string().nullish(),
  purchasedAt: z.string().nullish(),
  warrantyExpiresAt: z.string().nullish(),
  warrantyTerms: z.string().nullish(),
  status: z.enum(["IN_STOCK", "ASSIGNED", "REPAIR", "RETIRED"]),
  category: z.enum(["LAPTOP", "MONITOR", "PHONE", "OTHER"]),
  modelId: z.string().nullish(),
  // Transient cascade filters for the Model picker — stripped before submit (not asset fields).
  modelCategoryFilter: z.string().nullish(),
  modelManufacturerFilter: z.string().nullish(),
  assigneeId: z.string().nullish(),
});

function makeDefaults(iv: AssetFormProps["initialValues"]) {
  return {
    assetTag: iv?.assetTag ?? "",
    name: iv?.name ?? "",
    serial: iv?.serial ?? "",
    location: iv?.location ?? "",
    purchasedAt: iv?.purchasedAt ?? "",
    warrantyExpiresAt: iv?.warrantyExpiresAt ?? "",
    warrantyTerms: iv?.warrantyTerms ?? "",
    status: iv?.status ?? ("IN_STOCK" as const),
    category: iv?.category ?? ("LAPTOP" as const),
    modelId: iv?.modelId ?? undefined,
    modelCategoryFilter: undefined,
    modelManufacturerFilter: undefined,
    assigneeId: iv?.assigneeId ?? undefined,
  };
}

export function AssetForm({ initialValues, onSubmit, onCancel, loading = false }: AssetFormProps) {
  const t = useTranslations("assets");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    (initialValues?.customFields as Record<string, unknown>) ?? {},
  );

  const form = useZodForm(assetFormSchema, { defaultValues: makeDefaults(initialValues) });

  // Subscribe to the cascade filters at the component top level (useWatch is reliable —
  // form.watch() inside a Controller render does not re-subscribe) so the Model picker
  // refetches when either filter changes.
  const modelCategoryFilter = useWatch({ control: form.control, name: "modelCategoryFilter" });
  const modelManufacturerFilter = useWatch({
    control: form.control,
    name: "modelManufacturerFilter",
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(
          ({ modelCategoryFilter: _c, modelManufacturerFilter: _m, ...values }) =>
            onSubmit({ ...values, customFields }),
        )}
        className="flex max-w-[500px] flex-col gap-4"
      >
        <TextField name="assetTag" label={t("assetTag")} />

        <TextField name="name" label={t("name")} />

        <TextField name="serial" label={t("serial")} />

        <TextField name="location" label={t("location")} />

        <TextField name="purchasedAt" label={t("purchasedAt")} type="date" />

        <TextField name="warrantyExpiresAt" label={t("warrantyExpiresAt")} type="date" />

        <TextField name="warrantyTerms" label={t("warrantyTerms")} />

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

        {/* Cascade filters: narrow the Model picker by catalog category / manufacturer.
            Changing either resets the chosen Model so a stale selection can't survive. */}
        <FormField
          name="modelCategoryFilter"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("modelCategory")}</FormLabel>
              <RelationSelect
                path="/api/category"
                displayField="name"
                placeholder={t("modelCategory")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={(v) => {
                  field.onChange(v);
                  form.setValue("modelId", undefined);
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="modelManufacturerFilter"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("modelManufacturer")}</FormLabel>
              <RelationSelect
                path="/api/manufacturer"
                displayField="name"
                placeholder={t("modelManufacturer")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={(v) => {
                  field.onChange(v);
                  form.setValue("modelId", undefined);
                }}
              />
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
                filters={{
                  categoryId: modelCategoryFilter ?? undefined,
                  manufacturerId: modelManufacturerFilter ?? undefined,
                }}
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

        <CustomFields value={customFields} onChange={setCustomFields} />

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
