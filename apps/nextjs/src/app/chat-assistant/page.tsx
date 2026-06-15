'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useTRPC as useBillingTRPC } from '@acme/billing';
import { ChatAssistant } from '@acme/chat';

function ChatPage() {
  const queryClient = useQueryClient();
  const billingTrpc = useBillingTRPC();

  const handleTokensConsumed = () => {
    void queryClient.invalidateQueries(
      billingTrpc.account.getCreditUsage.pathFilter(),
    );
  };

  return (
    <div className="bg-muted min-h-screen flex-grow p-5">
      <ChatAssistant onTokensConsumed={handleTokensConsumed} />
    </div>
  );
}
export default ChatPage;
