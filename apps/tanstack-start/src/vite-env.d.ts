/// <reference types="vite/client" />

// No custom `import.meta.env` keys: auth config is authored in code
// (@acme/auth/env, ADR 0033) rather than read off `import.meta.env`.
// `vite/client` supplies the base `ImportMetaEnv`/`ImportMeta` types.
