/**
 * Reading this repo's own JSON — root `package.json`, `bank.paths.json`, a
 * workspace manifest — inside a test.
 *
 * `JSON.parse` returns `any`, and the two ways out of that are an assertion or
 * a check. These are checks, following `@acme/workspace-graph`: a field that is
 * not the shape a rule expects reads as absent, and the rule fails on the
 * absence with its own diagnostic rather than on a `TypeError` from a cast that
 * was never true.
 *
 * Not a `.test.ts`, so vitest does not collect it.
 */

import { readFileSync } from 'node:fs';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON file as an unknown, for one of the readers below to narrow. */
export function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed;
}

/** A string field — `name` on a manifest. `undefined` when absent or not one. */
export function stringField(value: unknown, field: string) {
  if (!isRecord(value)) return undefined;
  const entry = value[field];
  return typeof entry === 'string' ? entry : undefined;
}

/** The string-valued entries of an object field — `scripts`, `dependencies`. */
export function stringMap(
  value: unknown,
  field: string,
): Record<string, string> {
  if (!isRecord(value)) return {};
  const entry = value[field];
  if (!isRecord(entry)) return {};

  return Object.fromEntries(
    Object.entries(entry).flatMap(([key, item]) =>
      typeof item === 'string' ? [[key, item]] : [],
    ),
  );
}

/** The string entries of an array field — a bundle's `paths`. */
export function stringList(value: unknown, field: string): string[] {
  if (!isRecord(value)) return [];
  const entry = value[field];
  if (!Array.isArray(entry)) return [];
  return entry.filter((item): item is string => typeof item === 'string');
}

/** The records of an array field — `bank.paths.json`'s `bundles`. */
export function recordList(value: unknown, field: string) {
  if (!isRecord(value)) return [];
  const entry = value[field];
  if (!Array.isArray(entry)) return [];
  return entry.filter(isRecord);
}
