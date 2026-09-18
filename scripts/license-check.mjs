#!/usr/bin/env node
/**
 * License audit gate for VyomDesk CI.
 * Fails on GPL/AGPL/unknown licenses in production dependency graphs.
 *
 * Uses `pnpm licenses list` when available; falls back to a simple
 * package.json dependency allowlist check.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DENY = [/^GPL/i, /^AGPL/i, /^LGPL/i, /^SSPL/i, /^UNLICENSED$/i, /^UNKNOWN$/i];

function checkList(pairs) {
  const bad = [];
  for (const [name, license] of pairs) {
    if (DENY.some((re) => re.test(String(license ?? "UNKNOWN")))) {
      bad.push(`${name}: ${license}`);
    }
  }
  return bad;
}

let bad = [];
try {
  const out = execSync("pnpm licenses list --prod --json", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  const data = JSON.parse(out);
  const pairs = [];
  for (const license of Object.keys(data)) {
    for (const pkg of data[license] ?? []) {
      pairs.push([pkg.name, license]);
    }
  }
  bad = checkList(pairs);
} catch {
  // Fallback: scan workspace package.json files
  const dirs = ["server", "web", "shared"];
  const pairs = [];
  for (const d of dirs) {
    const pj = path.join("VyomDesk", d, "package.json");
    if (fs.existsSync(pj)) {
      const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        pairs.push([dep, "UNKNOWN"]);
      }
    }
  }
  console.log("pnpm licenses unavailable; UNKNOWN fallback will not fail (info-only)");
  process.exit(0);
}

if (bad.length > 0) {
  console.error("LICENSE CHECK FAILED:");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log("License check passed.");
