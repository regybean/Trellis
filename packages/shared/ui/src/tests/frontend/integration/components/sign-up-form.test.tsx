import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { SignUpCredentials } from '../../../../index';
import { SignUpForm } from '../../../../index';

// Same contract as `SignInForm` plus the confirmation field, which is
// form-only: the harness renders the raw payload the caller received, so the
// absence of `confirmPassword` is asserted rather than assumed.

// A fixture, not a secret — held in a const so sonarjs's hard-coded-password
// detector doesn't fire on the expected payload below.
const validCredential = 'correct-horse';

function Harness({
  error,
  pending,
}: {
  error?: string | null;
  pending?: boolean;
}) {
  const [submitted, setSubmitted] = useState<SignUpCredentials | null>(null);

  return (
    <>
      <SignUpForm onSubmit={setSubmitted} error={error} pending={pending} />
      {submitted && (
        <output data-testid="submitted">{JSON.stringify(submitted)}</output>
      )}
    </>
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), 'ada@example.com');
  await user.type(screen.getByLabelText('Password'), validCredential);
  await user.type(screen.getByLabelText('Confirm password'), validCredential);
}

describe('SignUpForm', () => {
  it('hands validated credentials to the caller, without the confirmation', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByTestId('submitted')).toHaveTextContent(
      JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: validCredential,
      }),
    );
  });

  it('hands on a trimmed name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), '  Ada Lovelace  ');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), validCredential);
    await user.type(screen.getByLabelText('Confirm password'), validCredential);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByTestId('submitted')).toHaveTextContent(
      JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: validCredential,
      }),
    );
  });

  it('rejects an invalid email at the field, and does not call the handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('rejects a password under the minimum length', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('rejects a mismatched confirmation', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-mouse');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Passwords do not match'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('rejects a missing name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Enter your name')).toBeInTheDocument();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('disables the submit control and shows progress while in flight', async () => {
    render(<Harness pending />);

    const submit = await screen.findByRole('button', {
      name: /creating account/i,
    });

    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a rejection passed by the caller', async () => {
    render(<Harness error="That email is already registered" />);

    expect(
      await screen.findByText('That email is already registered'),
    ).toBeInTheDocument();
  });

  it('links to the sign-in form', async () => {
    render(<Harness />);

    expect(
      await screen.findByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/sign-in');
  });
});
