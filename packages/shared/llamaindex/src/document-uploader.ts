import type { TextNode } from 'llamaindex';
import { Bedrock, BEDROCK_MODELS } from '@llamaindex/aws';
import { PGVectorStore } from '@llamaindex/postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
// https://developers.llamaindex.ai/typescript/framework/modules/data/readers/
import { LlamaParseReader } from 'llama-cloud-services';
import { SentenceSplitter, Settings, VectorStoreIndex } from 'llamaindex';
import { v5 as uuidv5 } from 'uuid';

import { logger } from '@acme/logger';

import type { DocumentMetadata } from './schemas/documents-schema';
import { BedrockEmbedding } from './embedding-model';
import { env } from './env';
import { documents, EMBED_DIMENSIONS } from './schemas/documents-schema';

import 'pgvector/pg';

const TEXT_NODE_NAMESPACE = '3b241101-e2bb-4255-8caf-4136c566a962';

function deterministicNodeId(node: TextNode): string {
  const content = node.getContent().toString().trim();
  return uuidv5(`${content}-${node.metadata.file_name}`, TEXT_NODE_NAMESPACE);
}

function deduplicateNodes(nodes: TextNode[]): TextNode[] {
  return [...new Map(nodes.map((node) => [node.id_, node])).values()];
}

const llm = new Bedrock({
  model: BEDROCK_MODELS.ANTHROPIC_CLAUDE_3_7_SONNET,
  region: 'eu-west-2',
});
Settings.llm = llm;

const embeddingModel = new BedrockEmbedding({
  model: 'cohere.embed-english-v3',
  region: 'eu-west-2',
  embedBatchSize: 10,
  maxRetries: 10,
  timeout: 60_000,
});
Settings.embedModel = embeddingModel;

const clientConfig = {
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_VECTOR_NAME,
  host: env.DB_HOST,
  port: env.DB_PORT,
};

const vectorStore = new PGVectorStore({
  clientConfig,
  dimensions: EMBED_DIMENSIONS,
  tableName: `${env.NEXT_PUBLIC_WEBAPP}_${env.DOCUMENTS_TABLE_NAME}`,
});

export const documentsIndex =
  await VectorStoreIndex.fromVectorStore(vectorStore);

// Drizzle connection for direct VDB operations (listing, deletion).
export const vdb = drizzle({
  connection: {
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_VECTOR_NAME,
  },
});

export interface DocumentFilenameSummary {
  filename: string;
  count: number;
  uploadTimestamp: number;
}

export class DocumentUploader {
  private llamaParseReaderInstance: LlamaParseReader | null = null;
  public index = documentsIndex;
  private vdb = vdb;
  private splitter = new SentenceSplitter({
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
  });

  private getLlamaParseReader() {
    this.llamaParseReaderInstance ??= new LlamaParseReader({
      baseUrl: 'https://api.cloud.eu.llamaindex.ai',
      apiKey: env.LLAMA_CLOUD_API_KEY,
    });
    return this.llamaParseReaderInstance;
  }

  /** Parse, chunk, embed and index a batch of files into the single document store. */
  async uploadDocs(files: File[]) {
    const parsed = await Promise.all(
      files.map(async (file) => {
        const buffer = await file.arrayBuffer();
        const pages = await this.getLlamaParseReader().loadDataAsContent(
          new Uint8Array(buffer),
          file.name,
        );
        if (pages.length === 0) {
          throw new Error(
            `No document could be parsed from file: ${file.name}`,
          );
        }
        const metadata: DocumentMetadata = {
          file_name: file.name,
          upload_timestamp: Date.now(),
          chunk_size: env.CHUNK_SIZE,
          parser: this.getLlamaParseReader().constructor.name,
        };
        for (const doc of pages) {
          doc.metadata = metadata;
        }
        return pages;
      }),
    ).then((results) => results.flat());

    const nodes = this.splitter.getNodesFromDocuments(parsed);
    const nodesWithIds = nodes.map((node) => {
      node.id_ = deterministicNodeId(node);
      return node;
    });
    const dedupedNodes = deduplicateNodes(nodesWithIds);

    logger.info(
      `[Chunked]: Created ${nodes.length} nodes, deduplicated to ${dedupedNodes.length} nodes.`,
    );

    await this.index.insertNodes(dedupedNodes, { logProgress: true });
  }

  /** List uploaded documents grouped by filename. */
  async listDocuments(): Promise<DocumentFilenameSummary[]> {
    return this.vdb
      .select({
        filename: sql<string>`(${documents.metadata} ->> 'file_name')`,
        count: sql<number>`count(*)::integer`,
        uploadTimestamp: sql<number>`max((${documents.metadata} ->> 'upload_timestamp')::double precision)`,
      })
      .from(documents)
      .groupBy(sql`(${documents.metadata} ->> 'file_name')`);
  }

  /** Delete all chunks belonging to a given filename. */
  async deleteByFilename(filename: string) {
    const deleted = await this.vdb
      .delete(documents)
      .where(sql`(${documents.metadata} ->> 'file_name') = ${filename}`)
      .returning({ id: documents.id });

    logger.info({ filename, deletedCount: deleted.length }, 'Deleted document');
    return { deletedCount: deleted.length, filename };
  }
}

export const documentUploader = new DocumentUploader();
