/// <reference types="vite/client" />

// No custom `import.meta.env` keys: the slim app strips auth entirely (ADR 0010),
// and the full apps author their auth config in code (@acme/auth/env, @acme/env ADR 0001)
// rather than reading it here. `vite/client` supplies the base
// `ImportMetaEnv`/`ImportMeta` types.
