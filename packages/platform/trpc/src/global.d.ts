// Global type declarations for the platform's auth seam. No identity-provider
// vocabulary lives here: the app adapter resolves whatever provider it uses and
// injects the neutral `InjectedSession` (see ./index.ts).
export type Roles = 'admin' | 'user';

declare global {
  // The injected user shape for `ctx.session.user`. Augmentable by design: the
  // platform reads only `id` (identity) and `role` (the `isAdmin` gate), so the
  // base declares exactly those two and nothing more. Apps and features sharpen
  // it to their own user shape — `@acme/billing` merges in the provider's `User`
  // to read `primaryEmailAddress`; a no-auth build augments it to its own shape.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
