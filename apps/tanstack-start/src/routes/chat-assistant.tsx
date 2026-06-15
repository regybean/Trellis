import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { useTRPC as useBillingTRPC } from '@acme/billing';
import { ChatAssistant } from '@acme/chat';

import { getAuthState } from '../lib/auth';

export const Route = createFileRoute('/chat-assistant')({
  beforeLoad: async ({ location }) => {
    const { userId } = await getAuthState();
    if (!userId) {
      throw redirect({
        to: '/sign-in/$',
        params: { _splat: '' },
        search: { redirect_url: location.href },
      });
    }
  },
  component: ChatRoute,
});

// Mirrors the Next.js chat page: invalidate billing credit usage when the chat
// reports consumed tokens. Reuses the `@acme/chat` + `@acme/billing` slices
// unchanged.
function ChatRoute() {
  const queryClient = useQueryClient();
  const billingTrpc = useBillingTRPC();

  const handleTokensConsumed = () => {
    void queryClient.invalidateQueries(
      billingTrpc.account.getCreditUsage.pathFilter(),
    );
  };

  return (
    <div className="min-h-full flex-grow p-5">
      <ChatAssistant onTokensConsumed={handleTokensConsumed} />
    </div>
  );
}
