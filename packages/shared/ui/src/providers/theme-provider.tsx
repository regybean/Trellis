'use client';

import type * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

// This module is the single home for the `next-themes` dependency: it owns the
// provider wrapper and re-exports the theme hook, so consumers read the active
// theme through the same seam that mounts the provider — never `next-themes`.
export { useTheme } from 'next-themes';

export function NextThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
