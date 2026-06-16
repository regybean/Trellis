'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { Button, cn } from '@acme/ui';

import { useFeedback } from '../hooks/use-feedback';

/**
 * Thumbs up/down for a single assistant message. Presentational — all data
 * access lives in `useFeedback`. Mounted by an app through the chat feature's
 * `renderMessageActions` render-slot, so the chat feature never depends on
 * `@acme/feedback`.
 */
export function FeedbackButtons({
  messageId,
  threadId,
}: {
  messageId: string;
  threadId: string;
}) {
  const { rating, rate, isSaving } = useFeedback(messageId, threadId);

  return (
    <div
      className="mt-1 flex items-center gap-1"
      data-testid={`feedback-${messageId}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Helpful"
        aria-pressed={rating === 'up'}
        disabled={isSaving}
        onClick={() => rate('up')}
        data-testid="feedback-up"
      >
        <ThumbsUp
          className={cn('h-4 w-4', rating === 'up' && 'fill-current')}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Not helpful"
        aria-pressed={rating === 'down'}
        disabled={isSaving}
        onClick={() => rate('down')}
        data-testid="feedback-down"
      >
        <ThumbsDown
          className={cn('h-4 w-4', rating === 'down' && 'fill-current')}
        />
      </Button>
    </div>
  );
}
