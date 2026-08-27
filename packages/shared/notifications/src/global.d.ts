// Global type declarations for the auth seam. Notifications sits below
// `@acme/auth`, so — like `@acme/trpc` itself — it mirrors the platform's
// augmentable `InjectedUser` base rather than importing `Roles`.
export type Roles = 'admin' | 'user';

declare global {
  // `ctx.session.user` shape. The platform declares this augmentable interface
  // and reads only `id` + `role`; the `stream` subscription reads `id` alone,
  // so this mirrors the base rather than sharpening it. See @acme/trpc.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
