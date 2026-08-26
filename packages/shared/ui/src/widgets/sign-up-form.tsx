'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';

import type { SignUpCredentials } from '../../src/lib/auth-credentials';
import {
  MIN_PASSWORD_LENGTH,
  signUpFormSchema,
} from '../../src/lib/auth-credentials';
import { cn } from '../../src/lib/utils';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '../ui/field';
import { Input } from '../ui/input';

interface SignUpFormProps {
  /**
   * Called with validated credentials — name, email and password. The
   * confirmation field is form-only and never handed on. As with
   * `SignInForm`, the caller owns the provider call (ADR 0010).
   */
  onSubmit: (credentials: SignUpCredentials) => void;
  /** A rejected attempt, rendered above the submit control. */
  error?: string | null;
  /** Submission in flight: the submit control disables and shows progress. */
  pending?: boolean;
  signInHref?: string;
  className?: string;
}

export function SignUpForm({
  onSubmit,
  error,
  pending = false,
  signInHref = '/sign-in',
  className,
}: SignUpFormProps) {
  const fieldId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const nameId = `${fieldId}-name`;
  const emailId = `${fieldId}-email`;
  const passwordId = `${fieldId}-password`;
  const confirmPasswordId = `${fieldId}-confirm-password`;

  // `noValidate` hands validation to zod rather than the browser, so the
  // messages are ours and assertable in the DOM.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = signUpFormSchema.safeParse({
      name,
      email,
      password,
      confirmPassword,
    });

    if (!parsed.success) {
      const { fieldErrors: errors } = z.flattenError(parsed.error);
      setFieldErrors({
        name: errors.name?.[0],
        email: errors.email?.[0],
        password: errors.password?.[0],
        confirmPassword: errors.confirmPassword?.[0],
      });
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
            <Field data-invalid={fieldErrors.name !== undefined}>
              <FieldLabel htmlFor={nameId}>Name</FieldLabel>
              <Input
                id={nameId}
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={fieldErrors.name !== undefined}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>

            <Field data-invalid={fieldErrors.email !== undefined}>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={fieldErrors.email !== undefined}
              />
              <FieldError>{fieldErrors.email}</FieldError>
            </Field>

            <Field data-invalid={fieldErrors.password !== undefined}>
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={fieldErrors.password !== undefined}
              />
              <FieldDescription>
                At least {MIN_PASSWORD_LENGTH} characters.
              </FieldDescription>
              <FieldError>{fieldErrors.password}</FieldError>
            </Field>

            <Field data-invalid={fieldErrors.confirmPassword !== undefined}>
              <FieldLabel htmlFor={confirmPasswordId}>
                Confirm password
              </FieldLabel>
              <Input
                id={confirmPasswordId}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={fieldErrors.confirmPassword !== undefined}
              />
              <FieldError>{fieldErrors.confirmPassword}</FieldError>
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? 'Creating account…' : 'Create account'}
            </Button>
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
