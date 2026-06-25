'use server';

import { auth, clerkClient } from '@clerk/nextjs/server';

// `formData.get` is `string | File | null`; the role form only ever submits
// text fields, so narrow to a string rather than blind-stringifying a File.
const getField = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

async function assertAdmin() {
  const { sessionClaims } = await auth();
  if (sessionClaims?.metadata.role !== 'admin') {
    throw new Error('Not authorized');
  }
}

export async function setRole(formData: FormData) {
  await assertAdmin();
  const role = getField(formData, 'role') === 'admin' ? 'admin' : 'user';
  const client = await clerkClient();
  await client.users.updateUserMetadata(getField(formData, 'id'), {
    publicMetadata: { role },
  });
}

export async function removeRole(formData: FormData) {
  await assertAdmin();
  const client = await clerkClient();
  await client.users.updateUserMetadata(getField(formData, 'id'), {
    publicMetadata: { role: null },
  });
}
