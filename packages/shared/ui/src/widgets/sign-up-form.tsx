'use client';

import { useState } from 'react';

import type {
  AuthFormProps,
  CredentialFieldErrors,
  SignUpCredentials,
} from '../lib/auth-credentials';
import { cn } from '../../src/lib/utils';
import {
  firstIssuePerField,
  MIN_PASSWORD_LENGTH,
  signUpFormSchema,
} from '../lib/auth-credentials';
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

interface SignUpFormProps extends AuthFormProps<SignUpCredentials> {
  signInHref?: string;
}

export function SignUpForm({
  onSubmit,
  error,
  pending = false,
  signInHref = '/sign-in',
  className,
}: SignUpFormProps) {
  const [fieldErrors, setFieldErrors] = useState<CredentialFieldErrors>({});

  // Uncontrolled inputs read through `FormData`, so validation messages are the
  // form's only state. `confirmPassword` is validated but never handed on — the
  // caller receives name, email and password.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = signUpFormSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );

    if (!parsed.success) {
      setFieldErrors(firstIssuePerField(parsed.error));
      return;
    }

    setFieldErrors({});
    onSubmit({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
    });
  };

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Sign up with your email address to get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <CredentialField
              label="Name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Ada Lovelace"
              error={fieldErrors.name}
            />

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
              autoComplete="new-password"
              description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              error={fieldErrors.password}
            />

            <CredentialField
              label="Confirm password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              error={fieldErrors.confirmPassword}
            />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <AuthSubmitButton
              pending={pending}
              label="Create account"
              pendingLabel="Creating account…"
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="text-sm">
        <p className="text-muted-foreground">
          Already have an account?{' '}
          <a href={signInHref} className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
