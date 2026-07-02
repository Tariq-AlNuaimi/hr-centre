"use client";

import * as React from "react";
import {
  useForm,
  type FieldValues,
  type Resolver,
  type UseFormProps,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType, infer as zInfer } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField as FormFieldPrimitive,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * FormField (ADR-029, Workstream C2) — the small react-hook-form wrapper API for
 * screens. `useZodForm` binds a zod schema (the SAME one guarding the API route)
 * as the resolver, so client-side validation and the server contract can't drift;
 * `TextField` is the labelled input for the common case, wiring RHF's field to
 * the accessible label/error primitives (aria-invalid + a role="alert" message
 * carrying the zod-shaped text). `Form` is re-exported for the provider. For
 * anything beyond a text field, compose the `@/components/ui/form` primitives
 * (FormField / FormItem / FormControl / FormMessage) directly.
 */

/** useForm pre-wired with a zod resolver — infers the form's value type from the schema. */
export function useZodForm<TSchema extends ZodType>(
  schema: TSchema,
  props?: Omit<UseFormProps<zInfer<TSchema>>, "resolver">,
) {
  // `schema as never` sidesteps the zod-v3 <-> @hookform/resolvers-v5 generic
  // skew (the resolver's overloads probe for a zod-v4 shape); the runtime value
  // is the schema unchanged, and the resolver is re-typed to the inferred form.
  return useForm<zInfer<TSchema>>({
    ...props,
    resolver: zodResolver(schema as never) as Resolver<zInfer<TSchema>>,
  });
}

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "id"> {
  /** RHF field name (a key of the form's schema). */
  name: string;
  /** Visible field label. */
  label: React.ReactNode;
  /** Optional helper text under the control. */
  description?: React.ReactNode;
}

/** A labelled text input bound to the enclosing <Form> by `name`. */
export function TextField({
  name,
  label,
  description,
  ...inputProps
}: TextFieldProps) {
  return (
    <FormFieldPrimitive<FieldValues>
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ""} {...inputProps} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export { Form };
