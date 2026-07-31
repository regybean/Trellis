import 'server-only';

// Server surface (`./server`): the concrete router + context an app mounts at
// `/api/trpc/notifications`, and the sole writer `publish` a background job
// calls. A worker/server importing this never pulls the `'use client'` React
// connectors (those live behind `.`).
export { appRouter } from './api/root';
export type { AppRouter } from './api/root';
export { createTRPCContext } from './api/trpc';
export { publish } from './api/services/publish';
// The per-user stream key builder — exported so a publishing feature can assert,
// in tests, the completion it wrote (read the stream back via `xRange`).
export { notificationKey } from './api/notification-keys';
