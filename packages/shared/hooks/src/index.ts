export const name = 'hooks';

export {
  AuthStatusProvider,
  loadingAuthStatus,
  resolvedAuthStatus,
  useAuthStatus,
  type AuthStatus,
} from './auth-status';
export { createFeatureClient } from './create-feature-client';
export { useClearCacheOnLogout } from './use-clear-cache-on-logout';
export { useGenericErrorHandler } from './use-generic-error-handler';
export {
  clearPersistedCache,
  createQueryPersister,
  persistMeta,
} from './query-persister';
