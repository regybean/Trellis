export const name = 'hooks';

export { useClearCacheOnLogout } from './use-clear-cache-on-logout';
export { useGenericErrorHandler } from './use-generic-error-handler';
export {
  clearPersistedCache,
  createQueryPersister,
  persistMeta,
} from './query-persister';
