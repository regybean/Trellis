/// <reference types="vite/client" />

// No custom `import.meta.env` keys: the Clerk publishable key that used to be
// read here is authored config (@acme/auth/env, ADR 0033). `vite/client` supplies
// the base `ImportMetaEnv`/`ImportMeta` types.
