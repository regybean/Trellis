#!/usr/bin/env node
// Dependency-audit gate
// (../docs/adr/0027-dependency-audit-gate-and-suppression-policy.md): fail on
// high/critical advisories, honouring the `auditConfig.ignoreGhsas` allowlist.
//
// Why this exists rather than a bare `pnpm audit --audit-level=high`: pnpm
// filters allowlisted advisories out of the *report* but still counts them in
// the severity summary, and its exit code reads that summary. So one allowlisted
// high — GHSA-w3rx-r6r6-pgpr today — makes the stage red forever, which is
// exactly the "gate can't be green" failure the allowlist exists to avoid.
// `advisories` in the JSON output *is* allowlist-filtered, so we decide from it.
//
// Transport failures are passed straight through (output + non-zero exit) so
// `scripts/quality-gate.sh` can still recognise them and skip the stage offline.

import { spawnSync } from "node:child_process";

const BLOCKING = new Set(["high", "critical"]);

const audit = spawnSync("pnpm", ["audit", "--json"], { encoding: "utf8" });

if (audit.error) {
  console.error(`audit: could not run \`pnpm audit\` — ${audit.error.message}`);
  process.exit(1);
}

/** pnpm emits one JSON document on stdout; anything else means it never got a report. */
function parseReport(stdout) {
  try {
    const report = JSON.parse(stdout);
    return report?.advisories ? report : null;
  } catch {
    return null;
  }
}

const report = parseReport(audit.stdout);

if (!report) {
  // No parsable report: a registry/transport error, or pnpm itself failed. Emit
  // what it said and keep its exit code — the gate greps this for network
  // patterns and skips, and fails on anything else.
  process.stdout.write(audit.stdout ?? "");
  process.stderr.write(audit.stderr ?? "");
  process.exit(audit.status === 0 ? 1 : (audit.status ?? 1));
}

const blocking = Object.values(report.advisories).filter((a) =>
  BLOCKING.has(a.severity),
);

if (blocking.length === 0) {
  const { high = 0, critical = 0 } = report.metadata?.vulnerabilities ?? {};
  const suppressed = high + critical;
  const note =
    suppressed > 0
      ? ` (${suppressed} allowlisted via auditConfig.ignoreGhsas)`
      : "";
  console.log(`audit: no high or critical advisories${note}`);
  process.exit(0);
}

for (const a of blocking) {
  const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []);
  console.error(
    [
      `${a.severity}: ${a.module_name} — ${a.title}`,
      `  vulnerable ${a.vulnerable_versions} · patched ${a.patched_versions}`,
      `  https://github.com/advisories/${a.github_advisory_id}`,
      ...paths.map((p) => `  path: ${p}`),
    ].join("\n"),
  );
}

console.error(
  `\naudit: ${blocking.length} high/critical advisor${
    blocking.length === 1 ? "y" : "ies"
  } — fix-first per docs/adr/0027-dependency-audit-gate-and-suppression-policy.md`,
);
process.exit(1);
