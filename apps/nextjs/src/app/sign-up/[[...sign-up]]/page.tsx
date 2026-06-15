'use client';

import { useSearchParams } from 'next/navigation';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';

import { SignUp } from '@acme/auth';

// App-owned auth UI composition: the wrapper (theme + redirect) lives in the
// app, the Clerk widget comes from the neutral `@acme/auth` surface.
export default function Page() {
  const { resolvedTheme } = useTheme();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url');

  return (
    <div className="flex h-screen items-center justify-center">
      <SignUp
        appearance={{ baseTheme: resolvedTheme === 'dark' ? dark : undefined }}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
