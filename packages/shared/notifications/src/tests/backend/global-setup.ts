import { redisContainer } from '@acme/redis/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// This suite touches a real Redis (the per-user notification streams). No
// Postgres — notifications owns no database. The descriptor is declared in
// @acme/redis/testing; @acme/test-utils is the engine that starts it (ADR 0017).
export default runInfraSetup([redisContainer]);
