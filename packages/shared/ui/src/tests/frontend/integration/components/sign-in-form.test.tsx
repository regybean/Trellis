import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { SignInCredentials } from '../../../../index';
import { SignInForm } from '../../../../index';

// `SignInForm` is presentational: validation, the in-flight state and the
// rejection message are its whole contract, and all three are observable in the
// DOM (ADR 0018). The caller's handler is exercised through a harness that
// renders what it received, so nothing here asserts a mock call count.

/** A caller whose provider call always succeeds. */
function Harness({
  onSubmit,
}: {
  onSubmit?: (credentials: SignInCredentials) => Promise<string | null>;
}) {
  const [submitted, setSubmitted] = useState<SignInCredentials | null>(null);

  return (
    <>
      <SignInForm
        onSubmit={
          onSubmit ??
          ((credentials) => {
            setSubmitted(credentials);
            return Promise.resolve(null);
          })
        }
      />
      {submitted && (
        <output data-testid="submitted">
          {`${submitted.email}|${submitted.password}`}
        </output>
      )}
    </>
  );
}

/**
 * A submit the test drives by hand: it stays in flight until `settlePending`
 * releases it, which is what makes both the in-flight and the returned-to-rest
 * assertions deterministic without a timer.
 */
const pendingSubmits: ((message: string | null) => void)[] = [];
const neverSettles = () =>
  new Promise<string | null>((resolve) => {
    pendingSubmits.push(resolve);
  });
const settlePending = (message: string | null) => {
  for (const resolve of pendingSubmits.splice(0)) resolve(message);
};

describe('SignInForm', () => {
  it('rejects an invalid email at the field, and does not call the handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const message = await screen.findByText('Enter a valid email address');
    const email = screen.getByLabelText('Email');

    expect(email).toBeInvalid();
    // The message is linked to the field, not just announced by its role.
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
    expect(message).toBeInTheDocument();
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
    const user = userEvent.setup();
    render(<Harness onSubmit={neverSettles} />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const submit = await screen.findByRole('button', { name: /signing in/i });

    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();

    // And it comes back: a settled attempt must not leave the control stuck.
    settlePending(null);
    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeEnabled();
  });

  it('renders a rejection without clearing the entered email', async () => {
    const user = userEvent.setup();
    render(
      <Harness onSubmit={() => Promise.resolve('Invalid email or password')} />,
    );

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Invalid email or password'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  });

  it('clears a previous rejection when the next attempt starts', async () => {
    const user = userEvent.setup();
    // Rejects the first attempt, then hangs — so the message must be gone
    // because the form cleared it, not because a success replaced it.
    let attempts = 0;
    const onSubmit = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.resolve('Invalid email or password')
        : neverSettles();
    };
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Invalid email or password'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('button', { name: /signing in/i }),
    ).toBeDisabled();
    expect(
      screen.queryByText('Invalid email or password'),
    ).not.toBeInTheDocument();
  });

  it('links to the sign-up form', async () => {
    render(<Harness />);

    expect(
      await screen.findByRole('link', { name: 'Sign up' }),
    ).toHaveAttribute('href', '/sign-up');
  });
});
