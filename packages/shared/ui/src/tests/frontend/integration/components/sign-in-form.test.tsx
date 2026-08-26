import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { SignInCredentials } from '../../../../index';
import { SignInForm } from '../../../../index';

// `SignInForm` is presentational: validation, pending and error are its whole
// contract, and all three are observable in the DOM (ADR 0018). The caller's
// handler is exercised through a harness that renders what it received, so
// nothing here asserts a mock call count.

function Harness({
  error,
  pending,
}: {
  error?: string | null;
  pending?: boolean;
}) {
  const [submitted, setSubmitted] = useState<SignInCredentials | null>(null);

  return (
    <>
      <SignInForm onSubmit={setSubmitted} error={error} pending={pending} />
      {submitted && (
        <output data-testid="submitted">
          {`${submitted.email}|${submitted.password}`}
        </output>
      )}
    </>
  );
}

/** Submitting is rejected by the caller, which feeds `error` back in. */
function RejectingHarness() {
  const [error, setError] = useState<string | null>(null);

  return (
    <SignInForm
      onSubmit={() => setError('Invalid email or password')}
      error={error}
    />
  );
}

describe('SignInForm', () => {
  it('rejects an invalid email at the field, and does not call the handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInvalid();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('rejects an empty password at the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your password')).toBeInTheDocument();
    expect(screen.queryByTestId('submitted')).not.toBeInTheDocument();
  });

  it('hands validated credentials to the caller', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('submitted')).toHaveTextContent(
      'ada@example.com|correct-horse',
    );
  });

  it('disables the submit control and shows progress while in flight', async () => {
    render(<Harness pending />);

    const submit = await screen.findByRole('button', { name: /signing in/i });

    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
  });

  it('renders a rejection without clearing the entered email', async () => {
    const user = userEvent.setup();
    render(<RejectingHarness />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Invalid email or password'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  });

  it('links to the sign-up form', async () => {
    render(<Harness />);

    expect(
      await screen.findByRole('link', { name: 'Sign up' }),
    ).toHaveAttribute('href', '/sign-up');
  });
});
