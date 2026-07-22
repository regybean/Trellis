import { createFileRoute, redirect } from '@tanstack/react-router';

import { ChatView } from '../components/chat-view';
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

// Bare route: starts a new Conversation (id minted client-side, URL stamped on
// first send). Reuses the `@acme/chat` + `@acme/billing` slices unchanged.
function ChatRoute() {
  return <ChatView />;
}
