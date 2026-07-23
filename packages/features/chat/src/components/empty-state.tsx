'use client';

import { BotMessageSquare } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
}

// Shown in place of the message list when a Conversation has no messages yet:
// the centered greeting that replaced the old seeded first assistant message.
// The app's pageTitle / pageDescription live here rather than in a top hero.
export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
      data-testid="chat-empty-state"
    >
      <BotMessageSquare className="text-muted-foreground h-12 w-12" />
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

export default EmptyState;
