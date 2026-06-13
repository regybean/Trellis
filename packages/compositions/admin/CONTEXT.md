# Admin (`@acme/admin`)

Server-side composition that assembles the admin dashboard from `@acme/billing`, `@acme/ingest`, and Clerk. Responsible for rendering one cohesive admin surface — it owns no business logic of its own.

## Language

**Admin dashboard**:
The single page available only to users with the `admin` Clerk role. Combines user management, knowledge base management, and Stripe testing tools.
_Avoid_: "back-office", "management panel"

**User management**:
The ability to search Clerk users by name/email and assign or remove the `admin` role. Surfaces `SearchUsers` and `UserManagement` components from this package.

## Relationships

- `AdminDashboard` (server component) checks `auth().sessionClaims.metadata.role === 'admin'` and redirects if not
- Composes: `UserManagement` + `DocumentsList` + `UploadDocumentsButton` (from `@acme/ingest`) + `StripeTesting` (from `@acme/billing`)
- `SearchUsers` and `UserManagement` are client components exported for use in other layouts if needed

## Design decisions

**Composition not feature**: This package contains no tRPC router. All data fetching goes through the routers of the features it composes (`@acme/billing`, `@acme/ingest`). The admin package only handles layout and authorization gating.
