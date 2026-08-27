'use client';

import { useState } from 'react';

import type {
  AuthFormProps,
  CredentialFieldErrors,
  SignInCredentials,
} from '../lib/auth-credentials';
import { cn } from '../../src/lib/utils';
import { firstIssuePerField, signInSchema } from '../lib/auth-credentials';
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
  error,
  pending = false,
  signUpHref = '/sign-up',
  className,
}: SignInFormProps) {
  const [fieldErrors, setFieldErrors] = useState<CredentialFieldErrors>({});

  // The inputs are uncontrolled: the DOM already holds what was typed, so the
  // only state worth keeping is the validation messages. `noValidate` hands
  // validation to zod rather than the browser, so the messages are ours and
  // assertable in the DOM.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = signInSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );

    if (!parsed.success) {
      setFieldErrors(firstIssuePerField(parsed.error));
      return;
    }

    setFieldErrors({});
    onSubmit(parsed.data);
  };

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter your email and password to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <CredentialField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              error={fieldErrors.email}
            />

            <CredentialField
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              error={fieldErrors.password}
            />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <AuthSubmitButton
              pending={pending}
              label="Sign in"
              pendingLabel="Signing in…"
            />
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
