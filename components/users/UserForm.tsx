"use client";

import { z } from "zod";
import { useTranslations } from "next-intl";
import { emailSchema } from "@/lib/validations/common";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface UserFormProps {
  initialValues?: {
    email?: string;
    name?: string;
    role?: string;
  };
  onSubmit: (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
  isEdit?: boolean;
}

export function UserForm({
  initialValues,
  onSubmit,
  onCancel,
  loading = false,
  isEdit = false,
}: UserFormProps) {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");

  // Mirrors createUserSchema/updateUserSchema (lib/validations/user.ts): password
  // is required (8..128) on create, optional on edit — an empty edit password
  // means "leave unchanged" (the edit page strips it before the API call), so we
  // only enforce the length floor once the operator actually types something.
  const schema = z.object({
    name: z.string().min(1).max(255),
    email: emailSchema,
    password: isEdit
      ? z
          .string()
          .max(128)
          .refine((v) => v.length === 0 || v.length >= 8)
      : z.string().min(8).max(128),
    role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      name: initialValues?.name ?? "",
      email: initialValues?.email ?? "",
      password: "",
      role: (initialValues?.role as "ADMIN" | "EDITOR" | "VIEWER") ?? "VIEWER",
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex max-w-[500px] flex-col gap-4"
      >
        <TextField name="name" label={t("name")} />

        <TextField name="email" label={t("email")} type="email" />

        <TextField
          name="password"
          label={t("password")}
          type="password"
          placeholder={isEdit ? t("passwordLeaveBlank") : undefined}
        />

        <FormField
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("role")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="ADMIN">{t("roleAdmin")}</SelectItem>
                  <SelectItem value="EDITOR">{t("roleEditor")}</SelectItem>
                  <SelectItem value="VIEWER">{t("roleViewer")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {tCommon("save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
