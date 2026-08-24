/// <reference types="vite/client" />

// No custom `import.meta.env` keys: the slim app strips Clerk (ADR 0010), so the
// `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` that used to be read here is gone. Auth is
// authored config in the full apps (@acme/auth/env, ADR 0033) and absent here.
// `vite/client` supplies the base `ImportMetaEnv`/`ImportMeta` types.
