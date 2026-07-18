"use client";

import { z } from "zod";
import { useTranslations } from "next-intl";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";

interface ManufacturerFormProps {
  initialValues?: Partial<{ name: string; website?: string | null }>;
  onSubmit: (values: { name: string; website?: string | null }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ManufacturerForm({
  initialValues,
  onSubmit,
  onCancel,
  loading = false,
}: ManufacturerFormProps) {
  const t = useTranslations("manufacturers");

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
    name: z.string().min(1),
    website: z.string().nullish(),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      name: initialValues?.name ?? "",
      website: initialValues?.website ?? "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
        <TextField name="name" label={t("name")} />

        <TextField name="website" label={t("website")} />

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
