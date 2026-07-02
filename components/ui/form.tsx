"use client";

import * as React from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * Form primitives — shadcn/ui-style react-hook-form bindings (ADR-029,
 * Workstream C2). `Form` re-exports RHF's FormProvider; `FormField` is a typed
 * Controller; `FormItem`/`FormLabel`/`FormControl`/`FormMessage` wire the
 * accessible label/description/error relationships (id + aria-describedby +
 * aria-invalid) automatically. Paired with `@hookform/resolvers`' zodResolver
 * at the form level, the zod-shaped validation message surfaces in FormMessage —
 * the same zod schema that already guards the API boundary. Replaces AntD
 * `<Form>` / `<Form.Item>` during the coexistence slice.
 */

export const Form = FormProvider;

type FormFieldContextValue = { name: string };
const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

type FormItemContextValue = { id: string };
const FormItemContext = React.createContext<FormItemContextValue | null>(null);

/** Reads the field id + RHF error state for the enclosing FormField/FormItem. */
export function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  if (!fieldContext) {
    throw new Error("useFormField must be used within <FormField>");
  }
  if (!itemContext) {
    throw new Error("useFormField must be used within <FormItem>");
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    name: fieldContext.name,
    formItemId: `${id}-control`,
    formDescriptionId: `${id}-description`,
    formMessageId: `${id}-message`,
    ...fieldState,
  };
}

export function FormItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn("flex flex-col gap-1.5", className)} {...props} />
    </FormItemContext.Provider>
  );
}

export function FormLabel({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  const { error, formItemId } = useFormField();
  return (
    <Label
      htmlFor={formItemId}
      className={cn(error && "text-destructive", className)}
      {...props}
    />
  );
}

/**
 * FormControl — injects the accessible ids + aria-invalid onto its single form
 * control child (a plain element clone, so no @radix-ui/react-slot dep).
 */
export function FormControl({
  children,
}: {
  children: React.ReactElement;
}) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();
  return React.cloneElement(
    children as React.ReactElement<Record<string, unknown>>,
    {
      id: formItemId,
      "aria-invalid": !!error,
      "aria-describedby": error
        ? `${formDescriptionId} ${formMessageId}`
        : formDescriptionId,
    },
  );
}

export function FormDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      id={formDescriptionId}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function FormMessage({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p
      id={formMessageId}
      role="alert"
      className={cn("text-xs font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
}
