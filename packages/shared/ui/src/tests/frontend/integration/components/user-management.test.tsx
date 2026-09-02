import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { UserManagementRole, UserManagementUser } from '../../../../index';
import { UserDetailedManagement, UserManagement } from '../../../../index';

// The role mutation is observed through what it renders — the harness holds the
// role in state, so a promotion shows up as the rendered badge changing — rather
// than through a mock call count (ADR 0018).

const ada: UserManagementUser = {
  id: 'usr_ada',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('1843-08-01T00:00:00.000Z'),
  role: 'admin',
};

const grace: UserManagementUser = {
  id: 'usr_grace',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  emailVerified: false,
  image: null,
  createdAt: new Date('1952-05-01T00:00:00.000Z'),
  role: 'user',
};

/** The role badge renders the raw union; `capitalize` is CSS, not text. */
const roleBadge = (role: UserManagementRole) => screen.getByText(role);

/** A `setRole` for the cases that assert rendering rather than mutation. */
const ignoreRole = () => Promise.resolve();

function DetailHarness({ initialRole }: { initialRole: UserManagementRole }) {
  const [role, setRole] = useState(initialRole);

  return (
    <UserDetailedManagement
      user={{ ...grace, role }}
      setRole={({ role: next }) => setRole(next)}
    />
  );
}

/** Open the role menu and pick an item from it. */
async function chooseRole(
  user: ReturnType<typeof userEvent.setup>,
  item: RegExp,
) {
  await user.click(await screen.findByRole('button', { name: 'Open menu' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('UserDetailedManagement', () => {
  it('renders the Better Auth user row', () => {
    render(<DetailHarness initialRole="user" />);

    expect(
      screen.getByRole('heading', { name: 'Grace Hopper' }),
    ).toBeInTheDocument();
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    expect(screen.getByText(`User ID: ${grace.id}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Created: ${grace.createdAt.toLocaleDateString()}`),
    ).toBeInTheDocument();
  });

  it('reports an unverified email as unverified', () => {
    render(<DetailHarness initialRole="user" />);

    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('falls back to name initials when the row has no image', () => {
    render(<DetailHarness initialRole="user" />);

    expect(screen.getByText('GR')).toBeInTheDocument();
  });

  it('promotes a user to admin', async () => {
    const user = userEvent.setup();
    render(<DetailHarness initialRole="user" />);

    expect(roleBadge('user')).toBeInTheDocument();

    await chooseRole(user, /Make Admin/);

    expect(await screen.findByText('admin')).toBeInTheDocument();
  });

  it('demotes an admin back to user', async () => {
    const user = userEvent.setup();
    render(<DetailHarness initialRole="admin" />);

    expect(roleBadge('admin')).toBeInTheDocument();

    await chooseRole(user, /Make User/);

    expect(await screen.findByText('user')).toBeInTheDocument();
  });

  it('renders the injected billing panels', () => {
    render(
      <UserDetailedManagement
        user={grace}
        setRole={ignoreRole}
        billingPanels={<p>Billing panel</p>}
      />,
    );

    expect(screen.getByText('Billing panel')).toBeInTheDocument();
  });

  it('omits billing entirely when no panels are injected', () => {
    render(<UserDetailedManagement user={grace} setRole={ignoreRole} />);

    expect(screen.queryByText('Billing panel')).not.toBeInTheDocument();
  });
});

describe('UserManagement', () => {
  it('lists every user with their email and current role', () => {
    render(<UserManagement users={[ada, grace]} setRole={ignoreRole} />);

    expect(screen.getByText('User Results (2)')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'ada@example.com' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'grace@example.com' }),
    ).toBeInTheDocument();
    expect(roleBadge('admin')).toBeInTheDocument();
    expect(roleBadge('user')).toBeInTheDocument();
  });

  it('opens the selected user in the detail dialog', async () => {
    const user = userEvent.setup();
    render(<UserManagement users={[grace]} setRole={ignoreRole} />);

    await user.click(screen.getByRole('button', { name: /User Management/ }));

    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).getByRole('heading', { name: 'Grace Hopper' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(`User: ${grace.email} (ID: ${grace.id})`),
    ).toBeInTheDocument();
  });
});
