import type { PlopTypes } from "@turbo/gen";
import { execSync } from "node:child_process";

/** Split an arbitrary string into lowercased words. */
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
const upperFirst = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const kebab = (s: string) => words(s).join("-");

interface FeatureAnswers {
  name: string;
  api: boolean;
  react: boolean;
  backendTests: boolean;
  frontendTests: boolean;
  anyTests?: boolean;
}

/** Build a package.json string tailored to the selected toggles. */
function featurePackageJson(name: string, o: FeatureAnswers): string {
  const anyTests = o.backendTests || o.frontendTests;

  const exportsField: Record<string, unknown> = {
    ".": { types: "./dist/index.d.ts", default: "./src/index.ts" },
  };
  if (o.api) {
    exportsField["./server"] = {
      types: "./dist/index-server.d.ts",
      default: "./src/index-server.ts",
    };
    exportsField["./schema"] = {
      types: "./dist/index-schema.d.ts",
      default: "./src/index-schema.ts",
    };
    exportsField["./env"] = {
      types: "./dist/env.d.ts",
      default: "./src/env.ts",
    };
  }

  const scripts: Record<string, string> = {
    build: "tsc",
    clean: "git clean -xdf .cache .turbo dist node_modules",
    format: "prettier --check . --ignore-path ../../.gitignore",
    lint: "eslint",
    typecheck: "tsc --noEmit",
  };
  if (anyTests) {
    const parts: string[] = [];
    if (o.backendTests) parts.push("pnpm test:backend");
    if (o.frontendTests) parts.push("pnpm test:frontend");
    scripts.test = parts.join(" && ");
    if (o.backendTests) {
      scripts["test:backend"] = "vitest run --config vitest.config.backend.ts";
      scripts["test:backend:watch"] =
        "vitest --watch --config vitest.config.backend.ts";
    }
    if (o.frontendTests) {
      scripts["test:frontend"] =
        "vitest run --config vitest.config.frontend.ts";
      scripts["test:frontend:watch"] =
        "vitest --watch --config vitest.config.frontend.ts";
    }
    scripts["test:watch"] = "vitest --watch";
  }

  const dependencies: Record<string, string> = {};
  if (o.api) {
    Object.assign(dependencies, {
      "@acme/billing": "workspace:*",
      "@acme/logger": "workspace:*",
      "@acme/redis": "workspace:*",
      "@acme/telemetry": "workspace:*",
      "@clerk/nextjs": "catalog:",
      "@opentelemetry/api": "catalog:",
      "@t3-oss/env-nextjs": "catalog:",
      "@trpc/server": "catalog:",
      "drizzle-orm": "catalog:",
      "drizzle-zod": "catalog:",
      "server-only": "catalog:",
      superjson: "catalog:",
      zod: "catalog:",
    });
  }
  if (o.react) {
    Object.assign(dependencies, {
      "@acme/ui": "workspace:*",
      "@tanstack/react-query": "catalog:",
      "@trpc/client": "catalog:",
      "@trpc/tanstack-react-query": "catalog:",
      "lucide-react": "catalog:",
      react: "catalog:",
      "react-dom": "catalog:",
      superjson: "catalog:",
    });
  }

  const devDependencies: Record<string, string> = {
    "@acme/eslint-config": "workspace:*",
    "@acme/prettier-config": "workspace:*",
    "@acme/tsconfig": "workspace:*",
    eslint: "catalog:",
    prettier: "catalog:",
    typescript: "catalog:",
  };
  if (anyTests) {
    devDependencies["@acme/vitest-config"] = "workspace:*";
    devDependencies.vitest = "catalog:";
  }
  if (o.backendTests) devDependencies["@acme/test-utils"] = "workspace:*";
  if (o.frontendTests) {
    Object.assign(devDependencies, {
      "@testing-library/jest-dom": "catalog:",
      "@testing-library/react": "catalog:",
      "@testing-library/user-event": "catalog:",
      "@vitejs/plugin-react": "catalog:",
      jsdom: "catalog:",
      msw: "catalog:",
      "msw-trpc": "catalog:",
    });
  }

  const sortKeys = (obj: Record<string, string>) =>
    Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );

  // Test-policy metadata (see scripts/check-test-policy.mjs + docs/TESTING.md).
  // A feature is full-stack when it ships UI, otherwise a backend library.
  const testClass = o.react ? "full-stack" : o.api ? "backend-library" : "none";
  const conforming =
    testClass === "full-stack"
      ? o.backendTests && o.frontendTests
      : testClass === "backend-library"
        ? o.backendTests
        : true;
  const acme =
    testClass === "none"
      ? {
          testClass,
          reason: "Utility package; no runtime seam to test.",
        }
      : conforming
        ? { testClass }
        : {
            testClass,
            testStatus: "todo",
            reason:
              "Scaffolded without full test coverage; add tests before release.",
          };

  const pkg = {
    name: `@acme/${name}`,
    private: true,
    type: "module",
    license: "MIT",
    exports: exportsField,
    scripts,
    ...(Object.keys(dependencies).length
      ? { dependencies: sortKeys(dependencies) }
      : {}),
    devDependencies: sortKeys(devDependencies),
    prettier: "@acme/prettier-config",
    acme,
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  // Deterministic case helpers so output is identical across plop versions.
  plop.setHelper("kebabCase", (s: string) => kebab(s));
  plop.setHelper("camelCase", (s: string) =>
    words(s)
      .map((w, i) => (i === 0 ? w : upperFirst(w)))
      .join(""),
  );
  plop.setHelper("pascalCase", (s: string) =>
    words(s).map(upperFirst).join(""),
  );

  const stripScope = (name: string) =>
    name.startsWith("@acme/") ? name.replace("@acme/", "") : name;

  // Install + format the freshly scaffolded package. Tolerates a failing
  // install (e.g. mid-refactor) so the generator still leaves usable files.
  const installAndFormat = (dir: string) => {
    try {
      execSync("pnpm install", { stdio: "inherit" });
    } catch {
      console.warn(
        "\n⚠️  pnpm install failed — scaffold written, run `pnpm install` manually once the workspace resolves.\n",
      );
    }
    try {
      execSync(`pnpm prettier --write "${dir}/**" --list-different`, {
        stdio: "inherit",
      });
    } catch {
      // formatting is best-effort
    }
    return `Scaffolded ${dir}`;
  };

  plop.setGenerator("feature", {
    description:
      "Scaffold a feature package — toggle API router, React UI, and backend/frontend tests",
    prompts: [
      {
        type: "input",
        name: "name",
        message:
          "Feature name? (skip the `@acme/` prefix, e.g. `documents` or `chat`)",
      },
      {
        type: "confirm",
        name: "api",
        message: "Include a tRPC API router + server context?",
        default: true,
      },
      {
        type: "confirm",
        name: "react",
        message:
          "Include React UI (components, hooks, client provider)? (No = backend-only: React ESLint/deps off)",
        default: true,
      },
      {
        type: "confirm",
        name: "backendTests",
        message: "Include backend tests (testcontainers + caller)?",
        default: true,
        when: (a: { api?: boolean; react?: boolean }) => a.api ?? a.react,
      },
      {
        type: "confirm",
        name: "frontendTests",
        message: "Include frontend tests (msw-trpc)?",
        default: true,
        when: (a: { react?: boolean }) => a.react,
      },
    ],
    actions: (raw) => {
      const data = raw as FeatureAnswers;
      data.name = stripScope(data.name);
      // React needs the API (AppRouter types); tests depend on their layer.
      if (data.react) data.api = true;
      data.backendTests = Boolean(data.backendTests) && data.api;
      data.frontendTests = Boolean(data.frontendTests) && data.react;
      data.anyTests = data.backendTests || data.frontendTests;

      const name = kebab(data.name);
      const dir = `packages/features/${name}`;
      const t = (rel: string) => `templates/feature/${rel}`;
      const x = (rel: string) => `templates/feature-extra/${rel}`;
      const add = (
        path: string,
        templateFile: string,
      ): PlopTypes.ActionType => ({
        type: "add",
        path: `${dir}/${path}`,
        templateFile,
      });

      const actions: PlopTypes.ActionType[] = [
        // package.json is built in JS so deps/exports/scripts match the toggles.
        {
          type: "add",
          path: `${dir}/package.json`,
          template: featurePackageJson(name, data),
        },
        // Always-present core (templates branch internally on the toggles).
        add("tsconfig.json", t("tsconfig.json.hbs")),
        add("eslint.config.ts", t("eslint.config.ts.hbs")),
        add("turbo.json", t("turbo.json.hbs")),
        add("README.md", t("README.md.hbs")),
        add("src/index.ts", t("src/index.ts.hbs")),
      ];

      if (data.api) {
        actions.push(
          add("src/env.ts", t("src/env.ts.hbs")),
          add("src/global.d.ts", t("src/global.d.ts.hbs")),
          add("src/index-server.ts", t("src/index-server.ts.hbs")),
          add("src/index-schema.ts", t("src/index-schema.ts.hbs")),
          add("src/api/trpc.ts", t("src/api/trpc.ts.hbs")),
          add("src/api/root.ts", t("src/api/root.ts.hbs")),
          add(
            "src/api/schemas/item-schema.ts",
            t("src/api/schemas/item-schema.ts.hbs"),
          ),
          add(`src/api/routers/${name}.ts`, x("router.ts.hbs")),
        );
      }

      if (data.react) {
        actions.push(
          add("src/trpc/react.tsx", t("src/trpc/react.tsx.hbs")),
          add("src/trpc/server.tsx", t("src/trpc/server.tsx.hbs")),
          add("src/trpc/query-client.ts", t("src/trpc/query-client.ts.hbs")),
          add(`src/components/${name}-list.tsx`, x("component.tsx.hbs")),
          add(`src/hooks/use-${name}.ts`, x("hook.ts.hbs")),
        );
      }

      if (data.backendTests) {
        actions.push(
          add("vitest.config.backend.ts", t("vitest.config.backend.ts.hbs")),
          add(
            "src/tests/backend/setup.ts",
            t("src/tests/backend/setup.ts.hbs"),
          ),
          add(
            "src/tests/backend/global-setup.ts",
            t("src/tests/backend/global-setup.ts.hbs"),
          ),
          add(
            "src/tests/backend/utils/test-context.ts",
            t("src/tests/backend/utils/test-context.ts.hbs"),
          ),
          add(
            "src/tests/backend/utils/fixtures.ts",
            t("src/tests/backend/utils/fixtures.ts.hbs"),
          ),
          add(`src/tests/backend/routers/${name}.test.ts`, x("test.ts.hbs")),
        );
      }

      if (data.frontendTests) {
        actions.push(
          add("vitest.config.frontend.ts", t("vitest.config.frontend.ts.hbs")),
          add(
            "src/tests/frontend/setup.tsx",
            t("src/tests/frontend/setup.tsx.hbs"),
          ),
          // Taxonomy per ADR 0018: the hook is the contract
          // (integration/hooks), the component renders through its providers
          // (integration/components); pure logic would go under unit/.
          add(
            `src/tests/frontend/integration/hooks/use-${name}.test.tsx`,
            x("frontend-hook-test.tsx.hbs"),
          ),
          add(
            `src/tests/frontend/integration/components/${name}-list.test.tsx`,
            x("frontend-test.tsx.hbs"),
          ),
        );
      }

      actions.push(() => installAndFormat(dir));
      return actions;
    },
  });

  plop.setGenerator("shared", {
    description: "Scaffold a shared package (reusable primitive library)",
    prompts: [
      {
        type: "input",
        name: "name",
        message:
          "Shared package name? (skip the `@acme/` prefix, e.g. `utils` or `documents`)",
      },
    ],
    actions: [
      (answers: { name: string }) => {
        answers.name = stripScope(answers.name);
        return "sanitized";
      },
      {
        type: "addMany",
        destination: "packages/shared/{{ kebabCase name }}",
        base: "templates/shared",
        templateFiles: "templates/shared/**/*.hbs",
      },
      (answers: { name: string }) =>
        installAndFormat(`packages/shared/${kebab(answers.name)}`),
    ],
  });
}
