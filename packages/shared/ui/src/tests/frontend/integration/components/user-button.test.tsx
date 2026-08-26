import type { ReactNode } from 'react';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DropdownMenuItem, UserButton } from '../../../../index';

// The injected sign-out handler is observed through what it renders — the
// harness swaps the button for a signed-out marker — so the assertion stays on
// the DOM rather than a mock call count (ADR 0018).

const ada = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};

function Harness({ menuItems }: { menuItems?: ReactNode }) {
  const [signedIn, setSignedIn] = useState(true);

  if (!signedIn) {
    return <p>Signed out</p>;
  }

  return (
    <UserButton
      user={ada}
      onSignOut={() => setSignedIn(false)}
      menuItems={menuItems}
    />
  );
}

describe('UserButton', () => {
  it('renders the user name and email on the trigger', async () => {
    render(<Harness />);

    const trigger = await screen.findByRole('button');

    expect(trigger).toHaveTextContent('Ada Lovelace');
    expect(trigger).toHaveTextContent('ada@example.com');
  });

  it('falls back to initials when there is no image', async () => {
    render(<Harness />);

    expect(await screen.findByText('AL')).toBeInTheDocument();
  });

  it('signs out through the injected handler', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button'));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByText('Signed out')).toBeInTheDocument();
  });

  it('renders app-supplied menu items above sign-out', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        menuItems={<DropdownMenuItem>Manage billing</DropdownMenuItem>}
      />,
    );

    await user.click(await screen.findByRole('button'));

    const items = await screen.findAllByRole('menuitem');

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Manage billing');
    expect(items[1]).toHaveTextContent('Sign out');
  });
});
