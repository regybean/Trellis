'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';

import type { SignInCredentials } from '../../src/lib/auth-credentials';
import { signInSchema } from '../../src/lib/auth-credentials';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

interface SignInFormProps {
  /**
   * Called with validated credentials. The form never talks to a provider —
   * the caller owns the sign-in call, so `@acme/ui` needs no `@acme/auth`
   * dependency (ADR 0010).
   */
  onSubmit: (credentials: SignInCredentials) => void;
  /** A rejected attempt, rendered above the submit control. */
  error?: string | null;
  /** Submission in flight: the submit control disables and shows progress. */
  pending?: boolean;
  signUpHref?: string;
  forgotPasswordHref?: string;
  className?: string;
}

export function SignInForm({
  onSubmit,
  error,
  pending = false,
  signUpHref = '/sign-up',
  forgotPasswordHref,
  className,
}: SignInFormProps) {
  const fieldId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const emailId = `${fieldId}-email`;
  const passwordId = `${fieldId}-password`;

  // `noValidate` on the form hands validation to zod rather than the browser,
  // so the messages are ours and assertable in the DOM.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = signInSchema.safeParse({ email, password });

    if (!parsed.success) {
      const { fieldErrors: errors } = z.flattenError(parsed.error);
      setFieldErrors({
        email: errors.email?.[0],
        password: errors.password?.[0],
      });
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
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={fieldErrors.password !== undefined}
              />
              <FieldError>{fieldErrors.password}</FieldError>
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <p className="text-muted-foreground">
          Don&apos;t have an account?{' '}
          <a href={signUpHref} className="text-primary hover:underline">
            Sign up
          </a>
        </p>
        {forgotPasswordHref && (
          <a
            href={forgotPasswordHref}
            className="text-muted-foreground hover:underline"
          >
            Forgot your password?
          </a>
        )}
      </CardFooter>
    </Card>
  );
}
