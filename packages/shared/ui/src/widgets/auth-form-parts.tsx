'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

/**
 * The pieces `SignInForm` and `SignUpForm` share. Internal to the auth widgets
 * — not re-exported from the barrel, so the package's public surface stays the
 * three components plus their credential types.
 */

interface CredentialFieldProps extends Omit<
  React.ComponentProps<typeof Input>,
  'id' | 'aria-invalid'
> {
  label: string;
  /** The field's validation message; absent means valid. */
  error?: string;
  description?: ReactNode;
}

/**
 * A labelled input carrying its own validation message. Owns the invalid
 * triplet — `data-invalid` for `Field`'s styling, `aria-invalid` on the input,
 * and `aria-describedby` linking the message so a screen reader reads it with
 * the field rather than only announcing it via `FieldError`'s `role="alert"`.
 */
export function CredentialField({
  label,
  error,
  description,
  ...inputProps
}: CredentialFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const invalid = error !== undefined;

  const describedBy =
    [
      description === undefined ? undefined : descriptionId,
      invalid ? errorId : undefined,
    ]
      .filter((value) => value !== undefined)
      .join(' ') || undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {description !== undefined && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
      {invalid && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}

interface AuthSubmitButtonProps {
  pending: boolean;
  /** Rendered at rest; the label a test finds the control by. */
  label: string;
  /** Rendered in flight, alongside the spinner. */
  pendingLabel: string;
}

export function AuthSubmitButton({
  pending,
  label,
  pendingLabel,
}: AuthSubmitButtonProps) {
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? pendingLabel : label}
    </Button>
  );
}
