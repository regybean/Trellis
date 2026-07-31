import { QueryClient } from '@tanstack/react-query';
import SuperJSON from 'superjson';

// Notifications is subscription-only — no queries, no offline persistence (a
// notification with no reader is simply never delivered; ADR 0030). So this is
// the plain QueryClient the tRPC React provider needs, with SuperJSON transport
// to match the server transformer. No persister, unlike chat/feedback.
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      dehydrate: {
        serializeData: SuperJSON.serialize,
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
