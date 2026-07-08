import { logger } from '@acme/logger';
import { ensureVectorIndex } from '@acme/rag';

/**
 * Second half of the one-shot migrate step (after `db:push`): create the
 * pgvector index/table the RAG store reads and writes. PgVector creates the
 * table lazily on first upsert, so a fresh DB needs this before any service
 * serves a read (ADR 0002). Idempotent — safe to re-run. Runs once here rather
 * than in each service's boot (ADR 0023, decision 4).
 */
await ensureVectorIndex();
logger.info('micro-migrate: vector index ensured');
