'use client';

import { ToastContainer } from 'react-toastify';

import { useTheme } from './theme-provider';

export function ToastThemeClient() {
  const { resolvedTheme } = useTheme();

  // Remount container on theme changes to ensure visuals update immediately
  return <ToastContainer theme={resolvedTheme} position="top-left" />;
}
