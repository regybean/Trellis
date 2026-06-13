'use server';

import { clerkClient } from '@clerk/nextjs/server';

import { checkRole } from './roles';

export async function setRole(formData: FormData) {
  const client = await clerkClient();

  // Check that the user trying to set the role is an admin
  const isAdmin = await checkRole('admin');
  if (!isAdmin) {
    return; //{ message: 'Not Authorized' };
  }

  await client.users.updateUserMetadata(formData.get('id') as string, {
    publicMetadata: { role: formData.get('role') },
  });
}

export async function removeRole(formData: FormData) {
  const client = await clerkClient();
  await client.users.updateUserMetadata(formData.get('id') as string, {
    publicMetadata: { role: null },
  });
}
