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

type Values = {
  label: string;
  key: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  required?: boolean;
};

interface CustomFieldDefFormProps {
  initialValues?: Partial<Values>;
  onSubmit: (values: Values) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function CustomFieldDefForm({
  initialValues,
  onSubmit,
  onCancel,
  loading = false,
}: CustomFieldDefFormProps) {
  const t = useTranslations("customFieldDefs");
  // `key` is immutable after create (it is the JSON key already stored on assets).
  const isEdit = Boolean(initialValues);

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
    label: z.string().min(1),
    key: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, t("keyHint")),
    type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]),
    required: z.boolean().optional(),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      label: initialValues?.label ?? "",
      key: initialValues?.key ?? "",
      type: initialValues?.type ?? "TEXT",
      required: initialValues?.required ?? false,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
        <TextField name="label" label={t("label")} />

        <TextField name="key" label={t("key")} disabled={isEdit} />

        <FormField
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("type")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("type")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="TEXT">{t("typeText")}</SelectItem>
                  <SelectItem value="NUMBER">{t("typeNumber")}</SelectItem>
                  <SelectItem value="DATE">{t("typeDate")}</SelectItem>
                  <SelectItem value="BOOLEAN">{t("typeBoolean")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="required"
          render={({ field }) => (
            <FormItem>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(field.value)}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {t("required")}
              </label>
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
