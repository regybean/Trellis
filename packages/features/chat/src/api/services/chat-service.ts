import type { Message } from '../schemas/message-schema';
import { ChatMemory } from './chat-memory';
import { RagWorkflow } from './rag-workflow';

class ChatService {
  private ragWorkflow = new RagWorkflow();

  query(prompt: string, messages: Message[], sessionId: string) {
    const chatMemory = new ChatMemory(messages);

    return this.ragWorkflow.query({
      query: prompt,
      chatMemory,
      sessionId,
    });
  }
}

export const chatService = new ChatService();
