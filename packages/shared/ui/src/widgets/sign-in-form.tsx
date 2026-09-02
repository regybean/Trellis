'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';

import type { AuthFormProps, SignInCredentials } from '../lib/auth-credentials';
import { cn } from '../../src/lib/utils';
import { firstErrorMessage, signInSchema } from '../lib/auth-credentials';
import { Alert, AlertDescription } from '../ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { FieldGroup } from '../ui/field';
import { AuthSubmitButton, CredentialField } from './auth-form-parts';

interface SignInFormProps extends AuthFormProps<SignInCredentials> {
  signUpHref?: string;
}

export function SignInForm({
  onSubmit,
  signUpHref = '/sign-up',
  className,
}: SignInFormProps) {
  // The rejected attempt, which only this component ever sees: it is set from
  // the caller's own resolution and cleared when a fresh attempt starts, so a
  // previous rejection cannot outlive it (#239).
  const [error, setError] = useState<string | null>(null);

  // TanStack Form takes the zod schema directly as a Standard Schema validator
  // — no resolver package, and the messages stay zod's. `noValidate` hands
  // validation to it rather than the browser, so those messages are the ones
  // that render and they are assertable in the DOM. Awaiting the caller inside
  // `onSubmit` is also what makes `isSubmitting` cover the provider call, so
  // "in flight" needs no second piece of state.
  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setError(await onSubmit(value));
    },
  });

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter your email and password to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          noValidate
        >
          <FieldGroup>
            <form.Field name="email">
              {(field) => (
                <CredentialField
                  label="Email"
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  error={firstErrorMessage(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <CredentialField
                  label="Password"
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  error={firstErrorMessage(field.state.meta.errors)}
                />
              )}
            </form.Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <AuthSubmitButton
                  pending={pending}
                  label="Sign in"
                  pendingLabel="Signing in…"
                />
              )}
            </form.Subscribe>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="text-sm">
        <p className="text-muted-foreground">
          Don&apos;t have an account?{' '}
          <a href={signUpHref} className="text-primary hover:underline">
            Sign up
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
