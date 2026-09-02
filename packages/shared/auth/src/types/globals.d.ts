// The provider-shaped *augmentation* of the injected principal, for the two full
// apps. Both include this file in their tsconfig, so it — and only it — adds the
// fields these apps map off a provider user onto the platform's neutral
// `InjectedUser` seam. The base (`id` + `role`) is declared once in `@acme/trpc`
// and arrives through its `dist/index.d.ts`; nothing is restated here.
//
// Swapping the provider out is a change to this file and `../principal.ts`, not
// to the platform or any feature.
export type { Roles } from '@acme/trpc';

declare global {
  // The extra field the full apps inject: the primary email `@acme/billing`
  // opens a Stripe customer with. Declared structurally, and identically to
  // billing's own augmentation — two declarations of one merged member have to
  // agree, and the shape is checked where it is actually read, in
  // `toPrincipal`.
  interface InjectedUser {
    primaryEmailAddress: { emailAddress: string } | null;
  }
}
