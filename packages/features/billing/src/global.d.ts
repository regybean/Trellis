// Billing's *augmentation* of the injected principal. The base (`id` + `role`)
// is declared once in `@acme/trpc` and arrives through its `dist/index.d.ts`,
// so nothing is restated here — this file only contributes the extra field
// billing reads off `ctx.session.user`.
//
// No imports, so this is an ambient script file and the interface merges into
// the global `InjectedUser` directly (no `declare global` wrapper needed).

// The account router opens a Stripe customer for the caller, so it needs the
// primary email address. Declared structurally, naming no auth provider, and
// identically to `@acme/auth`'s augmentation — two declarations of one merged
// member have to agree. The full apps map it off their provider's user.
interface InjectedUser {
  primaryEmailAddress: { emailAddress: string } | null;
}
