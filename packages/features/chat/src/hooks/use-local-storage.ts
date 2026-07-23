'use client';

import { useSyncExternalStore } from 'react';

// SSR-safe persisted state via the React-blessed external-store API:
// `getServerSnapshot` renders `defaultValue` on the server and during
// hydration (no mismatch), then React reconciles to the stored value. Writes
// notify same-tab subscribers by dispatching a `storage` event (the native one
// only fires in other tabs). Feature-local — not exported from the package.

// Module-level so the subscription reference is stable across renders.
function subscribe(onChange: () => void) {
  globalThis.addEventListener('storage', onChange);
  return () => globalThis.removeEventListener('storage', onChange);
}

export function useLocalStorage<T>(key: string, defaultValue: T) {
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => null,
  );

  const value = raw === null ? defaultValue : (JSON.parse(raw) as T);

  const set = (v: T) => {
    localStorage.setItem(key, JSON.stringify(v));
    globalThis.dispatchEvent(new StorageEvent('storage', { key }));
  };

  return [value, set] as const;
}
