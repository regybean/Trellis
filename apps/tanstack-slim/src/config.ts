import { configExtends } from '@acme/config';

/**
 * The app's config composition edge (ADR 0026). This app strips Clerk/billing,
 * so it has no config slices yet — the list is empty. `APP_ENV` is still
 * resolved at the edge (see `./env`); Phase 2 slice tunables (models/rag) join
 * the list here without new wiring.
 */
export const config = configExtends([]);
