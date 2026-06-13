'use client';

import { useTheme } from 'next-themes';
import { ToastContainer } from 'react-toastify';

export function ToastThemeClient() {
  const { resolvedTheme } = useTheme();

  // Remount container on theme changes to ensure visuals update immediately
  return <ToastContainer theme={resolvedTheme} position="top-left" />;
}
