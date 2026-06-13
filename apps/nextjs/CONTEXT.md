# App (`apps/nextjs`)

The deployed Next.js application. Wires features and compositions together into a runnable product. Owns no business logic — it is the integration layer.

## Language

**Route handler**:
A Next.js `route.ts` file that bridges a feature's tRPC router to an HTTP endpoint at `/api/trpc/{feature}/[trpc]`. Each feature has exactly one route handler in this app.
_Avoid_: "API route", "endpoint file"

## Structure

| Path                           | Purpose                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `app/chat-assistant/`          | Chat UI page — renders `ChatAssistant` from `@acme/chat`           |
| `app/admin/`                   | Admin dashboard page — renders `AdminDashboard` from `@acme/admin` |
| `app/pricing/`                 | Pricing page — renders `PricingPage` from `@acme/billing`          |
| `app/stripe/success/`          | Post-checkout redirect handler                                     |
| `app/sign-in/`, `app/sign-up/` | Clerk-hosted auth pages                                            |
| `app/api/trpc/billing/[trpc]/` | Route handler for `@acme/billing` router                           |
| `app/api/trpc/chat/[trpc]/`    | Route handler for `@acme/chat` router                              |
| `app/api/trpc/ingest/[trpc]/`  | Route handler for `@acme/ingest` router                            |
| `app/api/stripe/`              | Stripe webhook receiver                                            |
| `app/api/health/`              | Health check endpoint                                              |

## Relationships

- Each feature's `TRPCReactProvider` wraps its page(s) and points to its `/api/trpc/{feature}` endpoint
- `AdminDashboard` is wrapped in an admin-role guard (enforced inside `@acme/admin`)
- `instrumentation.ts` initialises OpenTelemetry via `@acme/telemetry` at startup
