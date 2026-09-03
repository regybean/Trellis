import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * The browser half of Better Auth (#223). App-owned: `@acme/auth` ships no React
 * at all (@acme/auth ADR 0001), so each app builds its own client.
 *
 * No `baseURL` — the auth routes are served by this same app at Better Auth's
 * default `/api/auth` base path, so the client's own origin is already correct,
 * on localhost and on every deploy target alike. Nothing to keep in sync.
 *
 * `adminClient()` mirrors the server's `admin()` plugin: the plugin pair is what
 * puts the role-management calls on this client. Both must be present or the
 * client's methods and the server's routes disagree.
 *
 * There is no provider to mount — the client keeps session state in a nanostore
 * and `useSession()` subscribes to it directly.
 */
export const authClient = createAuthClient({ plugins: [adminClient()] });
