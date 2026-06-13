import type {
  MetadataFilters,
  ModalityType,
  NodeWithScore,
  QueryBundle,
  QueryType,
} from 'llamaindex';
import { randomUUID } from '@llamaindex/env';
import { Settings, VectorIndexRetriever } from 'llamaindex';

export class MetadataRetriever extends VectorIndexRetriever {
  // https://github.com/run-llama/LlamaIndexTS/blob/a57e52a9c8d6ac99e28d45e9911d597f28abba95/packages/core/src/retriever/index.ts#L25s
  override async _retrieve(
    params: QueryBundle,
    filters?: MetadataFilters,
  ): Promise<NodeWithScore[]> {
    const { query } = params;
    const vectorStores = this.index.vectorStores;
    let nodesWithScores: NodeWithScore[] = [];

    for (const type in vectorStores) {
      const vectorStore = vectorStores[type as ModalityType];
      if (!vectorStore) continue;
      nodesWithScores = [
        ...nodesWithScores,
        ...(await this.retrieveQuery(
          query,
          type as ModalityType,
          vectorStore,
          filters,
        )),
      ];
    }
    return nodesWithScores;
  }
  override async retrieve(
    params: QueryType,
    filters?: MetadataFilters,
  ): Promise<NodeWithScore[]> {
    const cb = Settings.callbackManager;
    const queryBundle = typeof params === 'string' ? { query: params } : params;
    const id = randomUUID();
    cb.dispatchEvent('retrieve-start', { id, query: queryBundle });
    let response = await this._retrieve(queryBundle, filters);
    response = await this._handleRecursiveRetrieval(queryBundle, response);
    cb.dispatchEvent('retrieve-end', {
      id,
      query: queryBundle,
      nodes: response,
    });
    return response;

    const results = await super.retrieve(params);
    return results;
  }
}
