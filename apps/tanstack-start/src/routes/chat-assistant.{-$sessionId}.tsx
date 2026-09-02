import { createFileRoute, redirect } from '@tanstack/react-router';

import { ChatView } from '../components/chat-view';
import { getAuthState } from '../lib/auth';
import { redirectToSignIn } from '../lib/auth-redirect';

// ONE route for both the new-Conversation landing (`/chat-assistant`) and deep
// links (`/chat-assistant/{sessionId}`), via an optional path segment. Keeping
// both on a single route node is load-bearing: ConversationView stamps the id on
// first send with `history.replaceState`, and TanStack's patched history feeds
// that back to the router as a re-match. If bare vs. deep-link were separate
// route nodes, the re-match would swap components and remount ChatView — wiping
// the just-sent optimistic message. One node ⇒ the re-match only updates
// `sessionId` (which ConversationView reads once into state, so it's inert), so
// no remount and no torn SSE stream. Mirrors the Next.js optional catch-all
// `[[...sessionId]]`.
export const Route = createFileRoute('/chat-assistant/{-$sessionId}')({
  // The gate runs before the component mounts, so a signed-out visitor never
  // renders `ChatView` and no chat tRPC request is ever issued — the guard is
  // where "no request fires while unauthenticated" is actually enforced, not the
  // provider mounting in `__root`.
  beforeLoad: async ({ location }) => {
    const { userId } = await getAuthState();
    if (!userId) {
      throw redirect(redirectToSignIn(location.href));
    }
  },
  component: ChatRoute,
});

// Absent segment ⇒ a fresh Conversation is minted client-side and the URL stays
// bare until the first send; a present segment resumes that Conversation.
function ChatRoute() {
  const { sessionId } = Route.useParams();
  return <ChatView initialSessionId={sessionId} />;
}
