import { auth } from '@clerk/nextjs/server';

import type { Roles } from '../global';

export const checkRole = async (role: Roles) => {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata.role === role;
};
