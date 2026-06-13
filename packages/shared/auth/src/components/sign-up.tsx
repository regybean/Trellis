'use client';

import { useSearchParams } from 'next/navigation';
import { SignUp as ClerkSignUp } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';

export function SignUp() {
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
      <ClerkSignUp
        appearance={{
          baseTheme: resolvedTheme === 'dark' ? dark : undefined,
        }}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
