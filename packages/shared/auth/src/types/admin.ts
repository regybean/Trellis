import type { User as ClerkUser } from '@clerk/backend';

// Plain object type for user data that can be safely passed to client components
export interface SerializableUser {
  id: string;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  emailAddresses: {
    id: string;
    emailAddress: string;
  }[];
  publicMetadata: {
    role?: 'user' | 'admin';
  };
  createdAt: number;
  lastSignInAt: number | null;
}

// Transform Clerk User to serializable format
export function transformUserForClient(user: ClerkUser): SerializableUser {
  return {
    id: user.id,
    imageUrl: user.imageUrl,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: user.emailAddresses.map((email) => ({
      id: email.id,
      emailAddress: email.emailAddress,
    })),
    publicMetadata: {
      role: user.publicMetadata.role as 'user' | 'admin',
    },
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
  };
}
