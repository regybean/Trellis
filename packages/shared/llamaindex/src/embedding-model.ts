/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type {
  InvokeModelCommandInput,
  InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  AwsCredentialIdentity,
  AwsCredentialIdentityProvider,
} from '@aws-sdk/types';
import type { MessageContentDetail } from '@llamaindex/core/llms';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromEnv } from '@aws-sdk/credential-providers';
import { BaseEmbedding } from '@llamaindex/core/embeddings';
import { extractSingleText } from '@llamaindex/core/utils';
import { getEnv } from '@llamaindex/env';

const toUtf8 = (input: Uint8Array): string =>
  new TextDecoder('utf-8').decode(input);

// If you want to export this mapping externally, move it to a shared location.
const ALL_BEDROCK_EMBEDDING_MODELS = {
  // Amazon Titan Embeddings (via Bedrock)
  'amazon.titan-embed-text-v1': {
    // dimensions: 1536, // Not guaranteed; leave commented unless you confirm
    // tokenizer: Tokenizers.???  // Unknown tokenizer; leaving undefined
  },
  'amazon.titan-embed-text-v2:0': {
    // Titan V2 supports optional 'dimensions' and 'normalize' in request
    // dimensions: 1024, // Default is model-defined. Set only if you confirm.
    // dimensionOptions: [256, 512, 1024], // Set only if you confirm.
    // tokenizer: Tokenizers.???
  },
  'amazon.titan-embed-g1-text-02': {
    // dimensions: ???, // Unknown; set if you confirm
    // tokenizer: Tokenizers.???
  },

  // Cohere Embeddings (via Bedrock)
  'cohere.embed-english-v3': {
    // dimensions: 1024, // Not guaranteed via Bedrock; leave undefined
    // tokenizer: Tokenizers.??? // Unknown tokenizer
    // maxTokens: ??? // Unknown via Bedrock
  },
  'cohere.embed-multilingual-v3': {},
  'cohere.embed-v4:0': {},
} as const;

type BedrockModelKey = keyof typeof ALL_BEDROCK_EMBEDDING_MODELS;

// Providers
const PROVIDERS = {
  AMAZON: 'amazon',
  COHERE: 'cohere',
} as const;
type ProviderName = (typeof PROVIDERS)[keyof typeof PROVIDERS];

// Cohere constraints (from your Python code)
const COHERE_MAX_CHARS = 2048;

interface BedrockEmbeddingClientOptions {
  region?: string;
  endpoint?: string;
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  maxRetries?: number;
  timeoutMs?: number;
  // Use this as an escape hatch to pass extra BedrockRuntimeClient config

  additionalClientOptions?: Record<string, any>;
}

type BedrockEmbeddingInit = Omit<
  Partial<BedrockEmbedding>,
  'client' | 'lazyClient'
> & {
  client?: BedrockRuntimeClient;
};

function parseProviderFromModelId(modelId: string): ProviderName {
  // e.g. "amazon.titan-embed-text-v1" -> "amazon"
  // e.g. "cohere.embed-english-v3" -> "cohere"
  // Also support Bedrock Cohere IDs without prefix, e.g. "embed-english-v3"
  if (modelId.startsWith('amazon.')) return PROVIDERS.AMAZON;
  if (modelId.startsWith('cohere.')) return PROVIDERS.COHERE;

  // Bedrock often uses bare Cohere model IDs (no provider prefix)
  if (modelId.startsWith('embed-')) return PROVIDERS.COHERE;

  throw new Error(`Unsupported provider in modelId: ${modelId}`);
}

// Bedrock expects full model IDs including the provider prefix (e.g., "cohere.embed-english-v3" not just "embed-english-v3")
function normalizeModelIdForInvoke(modelId: string): string {
  // Don't strip the provider prefix - Bedrock needs the full ID
  return modelId;
}

function buildAmazonBody(
  model: string,
  payload: string,
  options: { dimensions?: number; normalize?: boolean },
): string {
  const body: Record<string, unknown> = { inputText: payload };

  // Only Titan v2:0 supports dimensions & normalize
  if ('dimensions' in options && options.dimensions !== undefined) {
    if (model === 'amazon.titan-embed-text-v2:0') {
      body.dimensions = options.dimensions;
    } else {
      throw new Error(
        "'dimensions' is only supported for 'amazon.titan-embed-text-v2:0'",
      );
    }
  }
  if ('normalize' in options && options.normalize !== undefined) {
    if (model === 'amazon.titan-embed-text-v2:0') {
      body.normalize = options.normalize;
    } else {
      throw new Error(
        "'normalize' is only supported for 'amazon.titan-embed-text-v2:0'",
      );
    }
  }

  return JSON.stringify(body);
}

function buildCohereBody(
  payload: string[] | string,
  inputType: 'text' | 'query',
): string {
  const typeMap = {
    text: 'search_document',
    query: 'search_query',
  } as const;
  const texts = Array.isArray(payload) ? payload : [payload];

  // Bedrock Cohere models expect 'texts' array with optional input_type
  // Trim each text to COHERE_MAX_CHARS to match Python behavior.
  const normalized = texts.map((t) =>
    t.length > COHERE_MAX_CHARS ? t.slice(0, COHERE_MAX_CHARS) : t,
  );

  return JSON.stringify({
    texts: normalized,
    input_type: typeMap[inputType],
  });
}

// Robust Cohere parser that handles v3/v4 response variants (mirrors Python)
function parseCohereEmbeddings(
  responseBody: Record<string, unknown>,
  isBatch: boolean,
): number[] | number[][] {
  // The data can come in multiple forms:
  // - { embeddings: [...] }
  // - { embeddings: { float: [...] } }
  // - { embeddings: { embeddings: { float: [...] } } }
  // - Or just [ ... ] directly (rare)
  let embeddings: unknown =
    (responseBody as any).embeddings ?? (responseBody as any);

  if (
    embeddings &&
    typeof embeddings === 'object' &&
    !Array.isArray(embeddings)
  ) {
    // if it has 'float'
    if ('float' in (embeddings as any)) {
      embeddings = (embeddings as any).float;
    } else if ('embeddings' in (embeddings as any)) {
      const nested = (embeddings as any).embeddings;
      embeddings =
        nested && typeof nested === 'object' && 'float' in nested
          ? nested.float
          : nested;
    } else {
      throw new Error(
        `Unexpected Cohere embedding response object: ${Object.keys(
          embeddings,
        ).join(', ')}`,
      );
    }
  }

  if (!Array.isArray(embeddings)) {
    throw new TypeError(
      `Unexpected Cohere embedding response type: ${typeof embeddings}`,
    );
  }

  // embeddings is number[][] for batch, number[] for single
  if (isBatch) {
    return embeddings as number[][];
  }
  const first = (embeddings as number[][])[0];
  if (!first) {
    throw new Error('Empty embeddings array returned');
  }
  return first;
}

function parseAmazonEmbeddings(
  responseBody: Record<string, unknown>,
): number[] {
  // Amazon Titan embedding response standard: { embedding: number[] }
  const arr = (responseBody as any).embedding;
  if (!Array.isArray(arr)) {
    throw new TypeError("Missing 'embedding' array in Amazon response");
  }
  return arr as number[];
}

function decodeBodyToJSON(
  body: InvokeModelCommandOutput['body'],
): Record<string, unknown> {
  // The utils.toUtf8 already handles different body shapes.
  const text = toUtf8(body as Uint8Array);
  return JSON.parse(text) as Record<string, unknown>;
}

export class BedrockEmbedding extends BaseEmbedding {
  // Model ID, e.g. "amazon.titan-embed-text-v1", "cohere.embed-english-v3"
  model: string;

  // Titan-specific optional fields (only v2:0 supports these)
  dimensions?: number;
  normalize?: boolean;

  // Session / client options
  region?: string;
  endpoint?: string;
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  maxRetries: number;
  timeout?: number; // in ms, aligns with OpenAIEmbedding
  additionalClientOptions?: BedrockEmbeddingClientOptions['additionalClientOptions'];

  // Lazy client
  lazyClient: () => Promise<BedrockRuntimeClient>;
  #client: Promise<BedrockRuntimeClient> | null = null;
  get client() {
    if (!this.#client) {
      this.#client = this.lazyClient();
    }
    return this.#client;
  }

  constructor(init?: BedrockEmbeddingInit) {
    super();

    // Defaults
    this.model = init?.model ?? 'amazon.titan-embed-text-v1';
    this.dimensions = init?.dimensions;
    this.normalize = init?.normalize;

    this.embedBatchSize = init?.embedBatchSize ?? 10;
    this.maxRetries = init?.maxRetries ?? 10;
    this.timeout = init?.timeout ?? 60 * 1000;

    this.region =
      init?.region ??
      getEnv('AWS_REGION') ??
      getEnv('AWS_DEFAULT_REGION') ??
      undefined;
    this.endpoint = init?.endpoint ?? undefined;
    this.credentials = init?.credentials ?? undefined;
    this.additionalClientOptions = init?.additionalClientOptions;

    // Optionally set embedInfo for known models if you confirm dimensions/tokenizers
    const key = Object.keys(ALL_BEDROCK_EMBEDDING_MODELS).find(
      (k) => k === this.model,
    ) as BedrockModelKey | undefined;
    if (key) {
      this.embedInfo = ALL_BEDROCK_EMBEDDING_MODELS[key] as any;
      // Example: if you confirm Titan v1 default dims and want truncation:
      // this.embedInfo = {
      //   dimensions: 1536,
      //   tokenizer: Tokenizers.CL100K_BASE, // only if accurate
      //   maxTokens: 8192,
      // };
    }

    // Lazy client
    this.lazyClient = () =>
      Promise.resolve(
        init?.client ??
          new BedrockRuntimeClient({
            region: this.region,
            endpoint: this.endpoint,
            // AWS SDK v3 uses maxAttempts
            maxAttempts: this.maxRetries,
            credentials: this.credentials ?? fromEnv(),
            // Spread any extra config last
            ...this.additionalClientOptions,
          }),
      );
  }

  // Override to support Cohere 'query' semantics (input_type)
  async getQueryEmbedding(
    query: MessageContentDetail,
  ): Promise<number[] | null> {
    const text = extractSingleText(query);
    if (!text) return null;
    return await this.getEmbedding(text, 'query');
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    return await this.getEmbedding(text, 'text');
  }

  // Batch support: Cohere supports batching, Amazon Titan does not.
  getTextEmbeddings = async (texts: string[]): Promise<number[][]> => {
    const provider = parseProviderFromModelId(this.model);

    // Ensure max token truncation if embedInfo was provided
    const input = this.truncateMaxTokens(texts);

    if (provider === PROVIDERS.COHERE) {
      // Single request for multiple texts
      const res = await this.invokeModelWithBody(
        this.buildRequestBody(provider, input, 'text'),
      );
      return parseCohereEmbeddings(res, true) as number[][];
    }

    // For Amazon Titan, fallback to default loop (one by one)
    // (You can optimize with concurrency later if needed)
    const out: number[][] = [];
    for (const t of input) {
      out.push(await this.getTextEmbedding(t));
    }
    return out;
  };

  // Core embedding request
  private async getEmbedding(
    payload: string,
    inputType: 'text' | 'query',
  ): Promise<number[]> {
    const provider = parseProviderFromModelId(this.model);

    // Respect maxTokens truncation if embedInfo is present
    const [input] = this.truncateMaxTokens([payload]);
    if (!input) {
      throw new Error('Input truncation resulted in empty string');
    }

    if (provider === PROVIDERS.AMAZON) {
      // Amazon Titan expects a single inputText per request
      const res = await this.invokeModelWithBody(
        this.buildRequestBody(provider, input, inputType),
      );
      return parseAmazonEmbeddings(res);
    }

    // Cohere can accept single or batch (array) - here single
    const res = await this.invokeModelWithBody(
      this.buildRequestBody(provider, input, inputType),
    );
    const single = parseCohereEmbeddings(res, false);
    return single as number[];
  }

  // Build JSON body based on provider
  private buildRequestBody(
    provider: ProviderName,
    payload: string | string[],
    inputType: 'text' | 'query',
  ): string {
    if (provider === PROVIDERS.AMAZON) {
      if (Array.isArray(payload)) {
        throw new TypeError(
          'Amazon Titan does not support batch embedding input.',
        );
      }
      return buildAmazonBody(this.model, payload, {
        dimensions: this.dimensions,
        normalize: this.normalize,
      });
    }

    return buildCohereBody(payload, inputType);
  }

  private async invokeModelWithBody(
    body: string,
  ): Promise<Record<string, unknown>> {
    const normalizedModelId = normalizeModelIdForInvoke(this.model);
    const params: InvokeModelCommandInput = {
      // Use full model IDs including the provider prefix (e.g., "cohere.embed-english-v3")
      modelId: normalizedModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    };

    const client = await this.client;
    const out = await client.send(new InvokeModelCommand(params));
    return decodeBodyToJSON(out.body);
  }

  // Helper for external consumers if desired
  static listSupportedModels(): Record<string, string[]> {
    const models = Object.keys(ALL_BEDROCK_EMBEDDING_MODELS);
    return {
      [PROVIDERS.AMAZON]: models.filter((m) => m.startsWith('amazon.')),
      [PROVIDERS.COHERE]: models.filter((m) => m.startsWith('cohere.')),
    };
  }
}
