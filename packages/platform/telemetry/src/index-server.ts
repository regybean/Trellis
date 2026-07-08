import 'server-only';

export {
  getActiveSpan,
  getTracer,
  setSpanAttributes,
  SpanStatusCode,
  withSpan,
} from './trpc';

export type { ChildSpanOptions } from './trpc';
