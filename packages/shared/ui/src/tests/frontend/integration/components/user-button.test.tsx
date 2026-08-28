import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { UserButton } from '../../../../index';

// The injected sign-out handler is observed through what it renders — the
// harness swaps the button for a signed-out marker — so the assertion stays on
// the DOM rather than a mock call count (ADR 0018).

const ada = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};

/** The trigger's accessible name comes from its own content. */
const trigger = { name: /Ada Lovelace/ };

function Harness() {
  const [signedIn, setSignedIn] = useState(true);

  if (!signedIn) {
    return <p>Signed out</p>;
  }

  return <UserButton user={ada} onSignOut={() => setSignedIn(false)} />;
}

describe('UserButton', () => {
  it('renders the user name and email on the trigger', async () => {
    render(<Harness />);

    const control = await screen.findByRole('button', trigger);

    expect(control).toHaveTextContent('Ada Lovelace');
    expect(control).toHaveTextContent('ada@example.com');
  });

  it('falls back to initials when there is no image', async () => {
    render(<Harness />);

    expect(await screen.findByText('AL')).toBeInTheDocument();
  });

  it('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', trigger));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByText('Signed out')).toBeInTheDocument();
  });
});
