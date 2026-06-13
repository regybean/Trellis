// The llamaindex retriever base types resolve loosely; see embedding-model.ts.
import type { Workflow } from '@llamaindex/workflow-core';
import type { NodeWithScore } from 'llamaindex';
import { Bedrock, BEDROCK_MODELS } from '@llamaindex/aws';
import { createWorkflow, workflowEvent } from '@llamaindex/workflow-core';
import { createStatefulMiddleware } from '@llamaindex/workflow-core/middleware/state';
import { MetadataMode } from 'llamaindex';

import { documentsIndex, MetadataRetriever } from '@acme/llamaindex/server';
import { logger } from '@acme/logger';

import type { LLMMessage } from '../schemas/chat-schema';
import type { ChatMemory } from './chat-memory';
import { getAppInfo } from '../../data/app-info';
import { env } from '../../env';

const startEvent = workflowEvent<{
  query: string;
  chatMemory?: ChatMemory;
}>();

const docsRetrievedEvent = workflowEvent<{
  docs: NodeWithScore[];
  query: string;
  chatMemory?: ChatMemory;
}>();

const progressEvent = workflowEvent<{ msg: string }>();

const resultEvent = workflowEvent<{
  answer: AsyncIterable<unknown>;
}>();

// ============================================================================
// RAG Workflow: retrieve over the single document index, then answer.
// ============================================================================
export class RagWorkflow {
  workflow: Workflow;
  retriever: MetadataRetriever;
  llm: Bedrock;

  constructor() {
    const { withState } = createStatefulMiddleware(() => ({}));
    this.workflow = withState(createWorkflow());

    this.retriever = new MetadataRetriever({ index: documentsIndex });

    this.llm = new Bedrock({
      model: BEDROCK_MODELS.ANTHROPIC_CLAUDE_3_7_SONNET,
      region: 'eu-west-2',
    });

    this.createHandlers();
  }

  public async *query(params: {
    query: string;
    chatMemory?: ChatMemory;
    sessionId: string;
  }) {
    const context = this.workflow.createContext();
    context.sendEvent(
      startEvent.with({
        query: params.query,
        chatMemory: params.chatMemory,
      }),
    );
    const answer = await new Promise<
      AsyncIterable<{ delta: string; raw: string }>
    >((resolve) => {
      context.stream.on(resultEvent, (event) => {
        resolve(
          event.data.answer as AsyncIterable<{ delta: string; raw: string }>,
        );
      });
      context.stream.on(progressEvent, (event) => {
        logger.info(`RAG Workflow Progress: ${event.data.msg}`);
      });
    });
    yield* answer;
  }

  private getSystemPrompt(): string {
    return getAppInfo(env.NEXT_PUBLIC_WEBAPP).systemPrompt;
  }

  private formatUserPrompt(queryStr: string, contextStr: string): string {
    return `
          Context information is below.
          ---------------------
          ${contextStr}
          ---------------------
          Given the context information and the conversation history, answer the question: ${queryStr}`;
  }

  private createHandlers() {
    this.workflow.handle([startEvent], async (context, event) => {
      const { query, chatMemory } = event.data;

      const docs = await this.retriever.retrieve(query);
      context.sendEvent(
        progressEvent.with({ msg: `Retrieved ${docs.length} document(s).` }),
      );

      return docsRetrievedEvent.with({ docs, query, chatMemory });
    });

    this.workflow.handle([docsRetrievedEvent], async (_context, event) => {
      const { docs, query, chatMemory } = event.data;

      const contextStr = docs
        .map((d) => d.node.getContent(MetadataMode.NONE))
        .join('\n\n');

      const messages: LLMMessage[] = [
        { role: 'system', content: this.getSystemPrompt() },
      ];

      if (chatMemory && !chatMemory.isEmpty()) {
        const llmMessages = chatMemory.getFormattedMessages();
        if (llmMessages) {
          messages.push(...llmMessages);
        }
      }

      messages.push({
        role: 'user',
        content: this.formatUserPrompt(query, contextStr),
      });

      const response = await this.llm.chat({ stream: true, messages });

      return resultEvent.with({ answer: response });
    });
  }
}
