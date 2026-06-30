import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "./spec";
import { readLock, writeLock } from "./lockfile";
import type { Lockfile } from "./lockfile";
import { check, fix, accept } from "./engine";
import type { Report } from "./engine";

interface Args {
  cmd: string;
  manifest: string;
  lock: string;
  root: string;
  tetherId?: string;
  rest: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "check", manifest: "tether.json", lock: "tether.lock", root: ".", rest: [] };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--manifest" || t === "-m") a.manifest = argv[++i] ?? a.manifest;
    else if (t === "--lock" || t === "-l") a.lock = argv[++i] ?? a.lock;
    else if (t === "--root" || t === "-r") a.root = argv[++i] ?? a.root;
    else a.rest.push(t);
  }
  if (a.cmd === "accept" && a.rest[0]) a.tetherId = a.rest[0];
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

  const manifest = loadManifest(args.manifest);
  const lock: Lockfile = readLock(args.lock);
  const root = resolve(args.root);

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
      console.error(`unknown command: ${args.cmd}\nusage: tether <check|fix|accept|init> [--manifest f] [--lock f] [--root d]`);
      process.exit(2);
      return;
  }

  printReport(report);
  process.exit(report.ok ? 0 : 1);
}

main();
