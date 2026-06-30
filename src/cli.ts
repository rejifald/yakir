import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "./spec";
import { readLock, writeLock } from "./lockfile";
import type { Lockfile } from "./lockfile";
import { check, fix, accept } from "./engine";
import type { Report } from "./engine";
import { findValueSites, seedValuesForTether } from "./discover";
import type { Candidate } from "./discover";

interface Args {
  cmd: string;
  manifest: string;
  lock: string;
  root: string;
  values: string[];
  tetherId?: string;
  rest: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    cmd: argv[0] ?? "check",
    manifest: "tether.json",
    lock: "tether.lock",
    root: ".",
    values: [],
    rest: [],
  };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--manifest" || t === "-m") a.manifest = argv[++i] ?? a.manifest;
    else if (t === "--lock" || t === "-l") a.lock = argv[++i] ?? a.lock;
    else if (t === "--root" || t === "-r") a.root = argv[++i] ?? a.root;
    else if (t === "--value" || t === "-v") {
      const v = argv[++i];
      if (v) a.values.push(v);
    } else a.rest.push(t);
  }
  if ((a.cmd === "accept" || a.cmd === "discover") && a.rest[0]) a.tetherId = a.rest[0];
  return a;
}

function loadManifest(path: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Manifest).tethers)) {
    throw new Error(`manifest ${path} must be an object with a "tethers" array`);
  }
  return raw as Manifest;
}

function tag(status: string): string {
  switch (status) {
    case "fresh":
    case "rebased":
      return "  ok   ";
    case "fixed":
      return " fixed ";
    case "integrity":
      return " BROKEN";
    default:
      return " DRIFT ";
  }
}

function printReport(report: Report): void {
  for (const f of report.findings) {
    console.log(`${tag(f.status)}  ${f.tetherId}  —  ${f.message}`);
    for (const w of f.writes) console.log(`           ${w.site.artifact}: ${w.from ?? "(none)"} -> ${w.to}`);
  }
  const s = report.summary;
  console.log(
    `\n${report.findings.length} tether(s): ${s.fresh + s.rebased} ok, ${s.fixed} fixed, ` +
      `${s.drifted} drift, ${s.conflict + s.disagree} conflict, ${s.integrity} broken`,
  );
}

function dedupe(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const key = `${c.artifact}|${JSON.stringify(c.suggested)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function printDiscover(seeds: string[], cands: Candidate[]): void {
  console.log(`seed values: ${seeds.map((v) => `"${v}"`).join(", ")}`);
  const byValue = new Map<string, Candidate[]>();
  for (const c of cands) {
    const list = byValue.get(c.value) ?? [];
    list.push(c);
    byValue.set(c.value, list);
  }
  for (const [value, list] of byValue) {
    console.log(`\n"${value}" — ${list.length} occurrence(s):`);
    for (const c of list.slice(0, 80)) {
      console.log(`  ${c.existing ? "·" : "+"} ${c.artifact}:${c.line}  ${c.context}`);
    }
    if (list.length > 80) console.log(`  … and ${list.length - 80} more`);
  }
  const fresh = dedupe(cands.filter((c) => !c.existing));
  console.log(`\n${fresh.length} new candidate site(s). Proposed sites (origin: discovered) — review before adding:`);
  console.log(
    JSON.stringify(
      fresh.map((c) => ({ artifact: c.artifact, locator: c.suggested, write: "manual" })),
      null,
      2,
    ),
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.cmd === "init") {
    if (existsSync(args.manifest)) {
      console.error(`${args.manifest} already exists`);
      process.exit(1);
    }
    writeFileSync(args.manifest, JSON.stringify({ tethers: [] }, null, 2) + "\n");
    console.log(`wrote ${args.manifest}`);
    return;
  }

  const root = resolve(args.root);

  if (args.cmd === "discover") {
    const manifest: Manifest = existsSync(args.manifest) ? loadManifest(args.manifest) : { tethers: [] };
    const lock = readLock(args.lock);
    const seeds = new Set<string>(args.values);
    let knownArtifacts = new Set<string>();
    if (args.tetherId) {
      const t = manifest.tethers.find((x) => x.id === args.tetherId);
      if (!t) {
        console.error(`no tether "${args.tetherId}" in ${args.manifest}`);
        process.exit(2);
      }
      for (const v of seedValuesForTether(root, t, lock)) seeds.add(v);
      knownArtifacts = new Set(t.sites.map((s) => s.artifact));
    }
    if (seeds.size === 0) {
      console.error("discover needs a tether id (to seed from its values) or one or more --value <v>");
      process.exit(2);
    }
    printDiscover([...seeds], findValueSites(root, [...seeds], { knownArtifacts, ignoreGlobs: manifest.ignore }));
    return;
  }

  const manifest = loadManifest(args.manifest);
  const lock: Lockfile = readLock(args.lock);

  let report: Report;
  switch (args.cmd) {
    case "check":
      report = check(manifest, root, lock);
      break;
    case "fix":
      report = fix(manifest, root, lock);
      writeLock(args.lock, lock);
      break;
    case "accept":
      report = accept(manifest, root, lock, { tetherId: args.tetherId });
      writeLock(args.lock, lock);
      break;
    default:
      console.error(
        `unknown command: ${args.cmd}\n` +
          `usage: tether <check|fix|accept|discover|init> [--manifest f] [--lock f] [--root d] [--value v]`,
      );
      process.exit(2);
      return;
  }

  printReport(report);
  process.exit(report.ok ? 0 : 1);
}

main();
