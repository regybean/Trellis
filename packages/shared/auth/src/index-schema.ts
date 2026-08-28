// Database schema exports — safe to import in any context (CLI, server, client
// build). No `server-only` guard, so drizzle-kit can load them: an app
// re-exports these from its own db/schema.ts to bring the auth tables under
// push/migrate. `authSchema` is exported so drizzle owns `CREATE SCHEMA auth`.
export {
  authSchema,
  authUser,
  authSession,
  authAccount,
  authVerification,
  authTables,
} from './schemas/auth-schema';
