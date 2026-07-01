import { createFileRoute, redirect } from '@tanstack/react-router';

import { ChatView } from '../components/chat-view';
import { getAuthState } from '../lib/auth';

export const Route = createFileRoute('/chat-assistant/$sessionId')({
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
  component: ChatSessionRoute,
});

// Deep-link route: resumes the Conversation named by the `sessionId` segment.
function ChatSessionRoute() {
  const { sessionId } = Route.useParams();
  return <ChatView initialSessionId={sessionId} />;
}
