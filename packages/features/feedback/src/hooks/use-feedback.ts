'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { persistMeta, useGenericErrorHandler } from '@acme/hooks';

import type { SubmitFeedbackRequest } from '../api/schemas/feedback-schema';
import { useTRPC } from '../trpc/react';

type Rating = SubmitFeedbackRequest['rating'];

/**
 * Data access for a single message's feedback. Components stay UI-focused and
 * delegate here (see CLAUDE.md). Reading `forMessage` and writing `submit` /
 * `remove` all key off the Mastra `messageId`; the caller's userId is implied
 * by the auth context server-side.
 */
export function useFeedback(messageId: string, threadId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const handleError = useGenericErrorHandler();

  // `meta: persistMeta` opts this query into the feature's persister so the
  // Rating renders instantly / offline on reload (ADR 0025). It's the only
  // feedback query marked; the submit/remove mutations are never persisted. The
  // mark is harmless when no persister is attached (no scopeKey → network-only).
  const feedbackQuery = useQuery({
    ...trpc.feedback.forMessage.queryOptions({ messageId }),
    meta: persistMeta,
  });

  const invalidate = () =>
    queryClient.invalidateQueries(
      trpc.feedback.forMessage.queryFilter({ messageId }),
    );

  const submitMutation = useMutation(
    trpc.feedback.submit.mutationOptions({
      onSettled: invalidate,
      onError: handleError,
    }),
  );

  const removeMutation = useMutation(
    trpc.feedback.remove.mutationOptions({
      onSettled: invalidate,
      onError: handleError,
    }),
  );

  const rating = feedbackQuery.data?.rating ?? null;

  const rate = (next: Rating) => {
    // Clicking the active rating clears it (toggle off).
    if (rating === next) {
      removeMutation.mutate({ messageId });
      return;
    }
    submitMutation.mutate({ messageId, threadId, rating: next });
  };

  return {
    rating,
    rate,
    isLoading: feedbackQuery.isLoading,
    isSaving: submitMutation.isPending || removeMutation.isPending,
  };
}
