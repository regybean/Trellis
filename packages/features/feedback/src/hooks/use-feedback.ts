'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useGenericErrorHandler } from '@acme/hooks';

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

  const feedbackQuery = useQuery(
    trpc.feedback.forMessage.queryOptions({ messageId }),
  );

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
