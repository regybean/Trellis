'use client';

import { useSearchParams } from 'next/navigation';
import { SignIn as ClerkSignIn } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';

export function SignIn() {
  const { resolvedTheme } = useTheme();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <ClerkSignIn
        appearance={{
          baseTheme: resolvedTheme === 'dark' ? dark : undefined,
        }}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
