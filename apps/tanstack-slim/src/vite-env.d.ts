/// <reference types="vite/client" />

// Typed client env. Vite exposes keys matching `envPrefix` (VITE_*,
// NEXT_PUBLIC_*) on `import.meta.env`; declaring them here keeps reads
// type-safe instead of `any`.
interface ImportMetaEnv {
  readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
