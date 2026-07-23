'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useTRPC as useBillingTRPC } from '@acme/billing';
import { ConversationView } from '@acme/chat';
import { FeedbackButtons } from '@acme/feedback';

// App adapter for the Conversation History surface: wires billing credit
// invalidation and the per-message feedback render-slot (kept in the app so the
// chat feature depends on neither). Mounted by the single optional-catch-all
// `/chat-assistant/[[...sessionId]]` route for both the new-Conversation landing
// and deep links.
export function ChatView({ initialSessionId }: { initialSessionId?: string }) {
  const queryClient = useQueryClient();
  const billingTrpc = useBillingTRPC();

  const handleTokensConsumed = () => {
    void queryClient.invalidateQueries(
      billingTrpc.account.getCreditUsage.pathFilter(),
    );
  };

  return (
    <div className="bg-muted h-full">
      <ConversationView
        initialSessionId={initialSessionId}
        onTokensConsumed={handleTokensConsumed}
        renderMessageActions={(message) =>
          message.id && message.sessionId ? (
            <FeedbackButtons
              messageId={message.id}
              threadId={message.sessionId}
            />
          ) : null
        }
      />
    </div>
  );
}
