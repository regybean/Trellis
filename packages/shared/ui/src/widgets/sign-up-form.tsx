'use client';

import { useForm } from '@tanstack/react-form';

import type { AuthFormProps, SignUpCredentials } from '../lib/auth-credentials';
import { cn } from '../../src/lib/utils';
import {
  firstErrorMessage,
  MIN_PASSWORD_LENGTH,
  signUpFormSchema,
  signUpSchema,
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
  // The form validates against `signUpFormSchema` (the rendered fields), then
  // re-parses through `signUpSchema` to build the payload. That second parse is
  // what applies the name's `trim()` and drops `confirmPassword` — the form-only
  // field — so the caller receives exactly `SignUpCredentials` without the
  // payload being assembled by hand. It cannot throw: the wider schema extends
  // the narrower one and has already passed.
  const form = useForm({
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
    validators: { onSubmit: signUpFormSchema },
    onSubmit: ({ value }) => {
      onSubmit(signUpSchema.parse(value));
    },
  });

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Sign up with your email address to get started.
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
            <form.Field name="name">
              {(field) => (
                <CredentialField
                  label="Name"
                  name={field.name}
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  error={firstErrorMessage(field.state.meta.errors)}
                />
              )}
            </form.Field>

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
                  autoComplete="new-password"
                  description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  error={firstErrorMessage(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Field name="confirmPassword">
              {(field) => (
                <CredentialField
                  label="Confirm password"
                  name={field.name}
                  type="password"
                  autoComplete="new-password"
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
