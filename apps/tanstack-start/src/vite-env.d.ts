/// <reference types="vite/client" />

// No custom `import.meta.env` keys: the Clerk publishable key that used to be
// read here is now config-as-code (authConfig, ADR 0026). `vite/client` supplies
// the base `ImportMetaEnv`/`ImportMeta` types.
