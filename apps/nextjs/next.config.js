import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
await jiti.import('./src/env');

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
);

const transpilePackages = Object.keys(pkg.dependencies ?? {}).filter((dep) =>
  dep.startsWith('@acme/'),
);

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  output: 'standalone',
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Suppress critical dependency warnings from OpenTelemetry
      config.module = {
        ...config.module,
        exprContextCritical: false,
      };

      // Ignore missing optional OpenTelemetry dependencies
      config.resolve.alias = {
        ...config.resolve.alias,
        '@opentelemetry/winston-transport': false,
      };
    }
    return config;
  },
};

export default config;
