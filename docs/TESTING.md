# Testing Guide

This document provides concise guidance for writing tests in the Cyrail Suite monorepo.

## Quick Start

```bash
# Run all tests with test environment
pnpm --filter @acme/chat test

# Backend tests only
pnpm --filter @acme/chat test:backend

# Frontend tests only
pnpm --filter @acme/chat test:frontend

# Watch mode
pnpm --filter @acme/chat test:backend:watch
```

### Testcontainers vs Docker Compose

| Mode           | When Used                   | Ports      |
| -------------- | --------------------------- | ---------- |
| Docker Compose | Local development (default) | 5432, 6379 |
| Testcontainers | CI                          | 5432, 6379 |

## Test Structure

```
packages/features/chat/src/tests/
├── backend/
│   ├── globalSetup.ts        # Starts testcontainers (if needed) and stops on close
│   ├── setup.ts              # Mocks (env, LLM, Clerk, etc.)
│   ├── routers/              # tRPC router tests
│   └── utils/                # Test context & fixtures
└── frontend/
    ├── setup.tsx             # React test setup
    └── *.test.tsx            # Component tests
```

## Core Principles

### 1. Mock env.ts, Not process.env

```typescript
// setup.ts - Mock the env module directly
vi.mock("../../env", () => ({
  env: {
    DB_HOST: "localhost",
    DB_PORT: 5432,
  },
}));
```

### 2. Test Middleware Once

Since all procedures share the same middleware, test auth/validation once (per package):

```typescript
describe("middleware (tested once)", () => {
  it("rejects unauthenticated requests", async () => {
    const caller = createCaller({ auth: { userId: null } });
    await expect(caller.chat.getProjects()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
```

### 3. Focus on Business Logic

Test the actual behavior with real database state:

```typescript
describe("get", () => {
  it("returns empty array for chat with no messages (zero)", async () => {
    const userId = createTestUserId();
    const chat = await createTestChat({ userId });
    const caller = createCaller({ auth: { userId } });

    const result = await caller.chat.get({ sessionId: chat.sessionId });

    expect(result).toEqual([]);
  });

  it("returns all messages in order (many)", async () => {
    const userId = createTestUserId();
    const { chat } = await createTestChatWithMessages({
      userId,
      messageCount: 10,
    });
    const caller = createCaller({ auth: { userId } });

    const result = await caller.chat.get({ sessionId: chat.sessionId });

    expect(result).toHaveLength(10);
  });
});
```

### 4. Zero, One, Many Pattern

Always test with different amounts of data:

```typescript
it('returns empty array when user has no chats (zero)', ...);
it('returns single chat (one)', ...);
it('returns all chats for specified user only (many)', ...);
```

### 5. Real DB, Mocked External Services

| Service       | Approach                                    |
| ------------- | ------------------------------------------- |
| PostgreSQL    | Real (via testcontainers or docker-compose) |
| Redis         | Real (via testcontainers or docker-compose) |
| Clerk Auth    | Mocked (never test Clerk itself)            |
| LLM/Bedrock   | Mocked                                      |
| Stripe        | Mocked                                      |
| OpenTelemetry | Noop implementation                         |

## Shared Test Utilities

The `@acme/test-utils` package provides:

### Testcontainers

```typescript
import {
  startContainers,
  stopContainers,
} from "@acme/test-utils/containers";

// In globalSetup.ts
export async function setup() {
  if (process.env.USE_TESTCONTAINERS === "true") {
    await startContainers();
  }
}
```

### Mocks

```typescript
import {
  createNoopTelemetry,
  createMockAuth,
} from "@acme/test-utils";
```

## Creating Test Context

Use the test context factory for tRPC testing:

```typescript
import { createTestContext, createTestUserId } from "../utils";

function createCaller(opts: TestContextOptions = {}) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

// Authenticated user
const caller = createCaller({ auth: { userId: createTestUserId() } });

// Admin user
const caller = createCaller({
  auth: { userId: createTestUserId(), role: "admin" },
});

// Rate-limited user
const caller = createCaller({
  auth: { userId: createTestUserId() },
  tokens: { remaining: 0 },
});
```

## Test Fixtures

Use fixtures to create test data:

```typescript
import {
  createTestChat,
  createTestChatWithMessages,
  createTestUserId,
  createTestSessionId,
} from "../utils";

// Create a chat
const chat = await createTestChat({ userId: "user_123" });

// Create a chat with messages
const { chat, messages } = await createTestChatWithMessages({
  userId: "user_123",
  messageCount: 5,
});
```

## What to Test

### ✅ Do Test

- Business logic (CRUD operations, data transformations)
- Authorization/ownership checks (can user X access resource Y?)
- Edge cases (empty data, large data sets, invalid states)
- Database state changes (verify data is persisted correctly)

### ❌ Don't Test

- Clerk authentication (it's mocked, test middleware behavior instead)
- External service implementations (Stripe API, LLM responses)
- Framework behavior (tRPC routing, Zod validation internals)

## Running Tests in CI

CI automatically:

2. Starts PostgreSQL container on port 5432
3. Starts Redis container on port 6379
4. Runs migrations
5. Executes tests
6. Stops containers

## Adding Tests to a New Package

1. Add dev dependency on `@acme/test-utils`
2. Create `vitest.config.backend.ts`:

```typescript
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@acme/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: "backend",
      environment: "node",
      include: ["src/tests/backend/**/*.test.ts"],
      setupFiles: ["./src/tests/backend/setup.ts"],
      globalSetup: ["./src/tests/backend/globalSetup.ts"],
      env: {
        REDIS_URL: "redis://localhost:6379", // need this annoyingly when redis in context
        NODE_ENV: "test",
      },
    },
  }),
);
```

3. Create `globalSetup.ts` and `globalTeardown.ts` using shared test-utils
4. Create `setup.ts` with mocks for your package's env.ts and external services
5. Add test scripts to package.json:

```json
{
  "scripts": {
    "test": "pnpm test:backend",
    "test:backend": "vitest run --config vitest.config.backend.ts",
    "test:backend:watch": "vitest --watch --config vitest.config.backend.ts"
  }
}
```
