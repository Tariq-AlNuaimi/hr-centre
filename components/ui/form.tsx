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

type FormItemContextValue = {
  id: string;
  // Whether a <FormDescription> is actually rendered in this item. FormControl
  // gates the description id in aria-describedby on this, so it never points at a
  // non-existent element (an axe violation) when no description is supplied.
  hasDescription: boolean;
  setHasDescription: (v: boolean) => void;
};
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
  const { id, hasDescription, setHasDescription } = itemContext;

  return {
    name: fieldContext.name,
    formItemId: `${id}-control`,
    formDescriptionId: `${id}-description`,
    formMessageId: `${id}-message`,
    hasDescription,
    setHasDescription,
    ...fieldState,
  };
}

export function FormItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId();
  const [hasDescription, setHasDescription] = React.useState(false);
  return (
    <FormItemContext.Provider value={{ id, hasDescription, setHasDescription }}>
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
      className={cn(error && "text-destructive-emphasis", className)}
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
  const { error, formItemId, formDescriptionId, formMessageId, hasDescription } =
    useFormField();
  // Reference only ids whose elements actually render: the description id when a
  // <FormDescription> is present, the message id when there's an error (FormMessage
  // renders iff error). An empty list yields no attribute — never a dangling
  // aria-describedby pointing at a non-existent node (axe: aria-valid-attr-value).
  const describedBy = [
    hasDescription ? formDescriptionId : null,
    error ? formMessageId : null,
  ].filter(Boolean);
  return React.cloneElement(
    children as React.ReactElement<Record<string, unknown>>,
    {
      id: formItemId,
      "aria-invalid": !!error,
      "aria-describedby": describedBy.length ? describedBy.join(" ") : undefined,
    },
  );
}

export function FormDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { formDescriptionId, setHasDescription } = useFormField();
  // Register presence so FormControl only points aria-describedby at this id while
  // the element is mounted. Effect (not render) so it's SSR-safe: the reference is
  // added post-mount, before which the element is simply unreferenced (never dangling).
  React.useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
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
      className={cn("text-xs font-medium text-destructive-emphasis", className)}
      {...props}
    >
      {body}
    </p>
  );
}
