export const name = 'feedback';
export { FeedbackButtons } from './components/feedback-buttons';
export { useFeedback } from './hooks/use-feedback';
export {
  clearPersistedCache,
  TRPCProvider as FeedbackTRPCProvider,
} from './trpc/react';
