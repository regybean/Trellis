import { runInfraSetup } from '@acme/test-utils/setup';

import { redisContainer } from '../../testing';

// The durable-stream integration suite tails a live Redis Stream; the unit suites
// touch nothing. One Redis container serves both (see docs/adr/0017).
export default runInfraSetup([redisContainer]);
