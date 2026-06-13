import type { Message } from '../schemas/message-schema';

export class ChatMemory {
  private readonly messages: Message[];

  constructor(messages: Message[]) {
    this.messages = messages;
  }

  getRecentMessages(): Message[] {
    // Change this for different memory length
    return this.messages.slice(-15);
  }

  getFormattedMessages():
    | { role: 'user' | 'assistant'; content: string }[]
    | null {
    const recentMessages = this.getRecentMessages();

    if (recentMessages.length === 0) {
      return null;
    }

    return recentMessages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text),
    }));
  }

  isEmpty(): boolean {
    return this.messages.length === 0;
  }

  getLength(): number {
    return this.messages.length;
  }
}
