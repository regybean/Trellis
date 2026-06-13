import { chatAgent } from './chat-agent';

// Streams an assistant response for a turn. Mastra Memory (keyed by thread =
// sessionId, resource = userId) supplies history and persists the new user and
// assistant messages around the call. Yields incremental text deltas so the
// tRPC subscription can keep its existing wire contract.
class ChatService {
  async *query(prompt: string, sessionId: string, userId: string) {
    const result = await chatAgent.stream(prompt, {
      memory: { thread: sessionId, resource: userId },
    });

    for await (const delta of result.textStream) {
      yield { delta };
    }
  }
}

export const chatService = new ChatService();
