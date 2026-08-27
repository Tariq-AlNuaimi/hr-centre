"use client";

import { z } from "zod";
import { useTranslations } from "next-intl";
import { emailSchema } from "@/lib/validations/common";
import { isPlatformAdminRole } from "@/lib/validations/user";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
    /** ADR-070 — the request's word for the platform role; `role` is the column's. */
    isPlatformAdmin: boolean;
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
    isPlatformAdmin: z.boolean(),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      name: initialValues?.name ?? "",
      email: initialValues?.email ?? "",
      password: "",
      isPlatformAdmin: isPlatformAdminRole(initialValues?.role),
    },
  });

  return (
    <Form {...form}>
      <form
        method="post"
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

        {/*
          ADR-070 — one checkbox, naming exactly what it grants, in place of a
          three-value dropdown that the product only ever read two ways. EDITOR
          gated nothing (`withEditorAuth` was never called) and VIEWER gated
          nothing, so the choice HR was asked to make was between "administrator"
          and two words for "not administrator".

          The hint is the whole point: a role is only meaningful if the person
          setting it can tell what it does. And it says what this is NOT — §4.1's
          HR authority is a different axis (ADR-065), granted elsewhere, and
          conflating them is the confusion this replaces.
        */}
        <FormField
          name="isPlatformAdmin"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  {/*
                    NO `id` here and NO `htmlFor` on the label below, deliberately.
                    `FormControl` clones this element and injects `id={formItemId}`,
                    and `FormLabel` already points `htmlFor` at the same id. Setting
                    them by hand looked tidier and was broken: the control's own id
                    was overwritten while the label's `htmlFor` survived the spread,
                    so the label pointed at an element that did not exist — an
                    unlabelled checkbox for a screen reader, on the one control that
                    grants administrative access. Caught by driving the form, not by
                    reading it.
                  */}
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </FormControl>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <FormLabel className="cursor-pointer">{t("platformAdmin")}</FormLabel>
                  {/*
                    A FormDescription, not two loose spans: it registers itself into
                    the control's `aria-describedby`, so the sentence explaining what
                    the box grants is read out WITH the box rather than sitting
                    beside it unannounced.
                  */}
                  <FormDescription>
                    {t("platformAdminHint")}
                    <span className="mt-0.5 block">{t("platformAdminNotHr")}</span>
                  </FormDescription>
                </div>
              </div>
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
