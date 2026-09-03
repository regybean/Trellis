/// <reference types="vite/client" />

// No custom `import.meta.env` keys: auth config is authored in code
// (@acme/auth/env, @acme/env ADR 0001) rather than read off `import.meta.env`.
// `vite/client` supplies the base `ImportMetaEnv`/`ImportMeta` types.
