// packages/ui-shared/src/hooks/useGenericErrorHandler.ts
import type { TRPCClientErrorLike } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import React, { useCallback } from 'react';
import { toast } from 'react-toastify';

/**
 * Display beautiful toast notifications for TRPC errors.
 * - Handles TOO_MANY_REQUESTS with a special message
 * - Falls back to a clean generic error for everything else
 */
export function useGenericErrorHandler<
  TRouter extends AnyRouter = AnyRouter,
>() {
  return useCallback((error?: TRPCClientErrorLike<TRouter>) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const code = error?.data?.code;
    const message = error?.message;

    if (code === 'TOO_MANY_REQUESTS') {
      toast.error(message ?? 'Request limit exceeded', {
        toastId: 'rate-limit',
        autoClose: 6000,
        closeButton: true,
        icon: () =>
          React.createElement('span', { style: { fontSize: 16 } }, '⏳'),
      });
      return;
    }

    toast.error('Service currently unavailable. Please try again later.', {
      autoClose: 5000,
      closeButton: true,
      icon: () =>
        React.createElement('span', { style: { fontSize: 16 } }, '⚠️'),
    });
  }, []);
}
