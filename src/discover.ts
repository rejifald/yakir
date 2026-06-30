import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import type { Locator, Tether } from "./spec";
import { escapeRegExp } from "./locators";
import type { Lockfile } from "./lockfile";
import { extractSite } from "./extract";

// Value-seeded discovery: given a fact's known values, sweep the repo for every
// other place those values appear. Occurrences holding a *stale* value are
// exactly the under-covered drift a hand-written manifest would miss.
//
// SECURITY: discovery is file-only. It proposes only json-pointer/pattern
// sites (never a `command`), and it never *executes* a command site when seeding
// from a tether — a command runs arbitrary shell, so it stays strictly
// declared-only (you opt in by hand-writing it in the manifest).

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".vercel",
  ".svelte-kit",
  ".astro",
]);
const IGNORE_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "tether.lock"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mov", ".webm",
  ".mp3", ".wav", ".zip", ".gz", ".tgz", ".br", ".wasm", ".node", ".jar", ".class",
]);
const MAX_BYTES = 1_000_000;

export interface WalkOptions {
  ignoreDirs?: Set<string>;
  /** User-defined ignore globs (repo-relative), added on top of the infra defaults. */
  ignoreGlobs?: string[];
  maxBytes?: number;
}

/** Minimal glob → RegExp: `**` spans path separators, `*` does not, `?` is one non-slash char. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^(?:" + re + ")$");
}

export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const ignoreDirs = opts.ignoreDirs ?? IGNORE_DIRS;
  const globs = (opts.ignoreGlobs ?? []).map(globToRegExp);
  const rel = (p: string): string => relative(root, p).split(sep).join("/");
  const ignored = (path: string): boolean => globs.some((re) => re.test(path));

  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (ignoreDirs.has(e.name)) continue;
        const r = rel(full);
        if (ignored(r) || ignored(r + "/")) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (IGNORE_FILES.has(e.name)) continue;
        if (BINARY_EXT.has(extname(e.name).toLowerCase())) continue;
        if (ignored(rel(full))) continue;
        out.push(full);
      }
    }
  }
  return out;
}

function readText(abs: string, maxBytes: number): string | undefined {
  let buf: Buffer;
  try {
    if (statSync(abs).size > maxBytes) return undefined;
    buf = readFileSync(abs);
  } catch {
    return undefined;
  }
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return undefined; // binary sniff
  return buf.toString("utf8");
}

export interface Candidate {
  artifact: string;
  line: number;
  value: string;
  context: string;
  suggested: Locator;
  /** Already referenced (by file) by the seeding tether — i.e. probably known. */
  existing: boolean;
}

export interface DiscoverOptions extends WalkOptions {
  knownArtifacts?: Set<string>;
}

export function findValueSites(root: string, values: string[], opts: DiscoverOptions = {}): Candidate[] {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const known = opts.knownArtifacts ?? new Set<string>();
  const seeds = [...new Set(values.filter((v) => v.length > 0))];
  if (seeds.length === 0) return [];

  const found: Candidate[] = [];
  for (const abs of walkFiles(root, opts)) {
    const text = readText(abs, maxBytes);
    if (text === undefined) continue;
    const rel = relative(root, abs).split(sep).join("/");

    let jsonDoc: unknown;
    let jsonParsed = false;
    const asJson = (): unknown => {
      if (!jsonParsed) {
        jsonParsed = true;
        try {
          jsonDoc = JSON.parse(text);
        } catch {
          jsonDoc = undefined;
        }
      }
      return jsonDoc;
    };

    for (const value of seeds) {
      let idx = text.indexOf(value);
      while (idx !== -1) {
        const ctx = lineAt(text, idx);
        let suggested: Locator | undefined;
        if (rel.endsWith(".json")) {
          const ptr = findPointer(asJson(), value);
          if (ptr) suggested = { kind: "json-pointer", path: ptr };
        }
        if (!suggested) suggested = { kind: "pattern", match: suggestPattern(ctx, value) };
        found.push({
          artifact: rel,
          line: countLines(text, idx),
          value,
          context: truncate(ctx.trim(), 120),
          suggested,
          existing: known.has(rel),
        });
        idx = text.indexOf(value, idx + value.length);
      }
    }
  }
  return found;
}

/** Seed discovery from a tether's current site values plus its lock baseline. */
export function seedValuesForTether(root: string, tether: Tether, lock?: Lockfile): string[] {
  const vals = new Set<string>();
  for (const s of tether.sites) {
    // Never run a command to seed discovery (declared-only boundary), and skip
    // set-valued sites — their canonical "a, b, c" string is not a searchable value.
    if (s.locator.kind === "command" || (s.locator.kind === "pattern" && s.locator.all)) continue;
    const ex = extractSite(root, s);
    if (ex.value !== undefined) vals.add(ex.value);
  }
  const base = lock?.tethers[tether.id]?.baseline;
  if (base) vals.add(base);
  return [...vals];
}

// ---------- helpers ----------

function countLines(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function lineAt(text: string, idx: number): string {
  let start = idx;
  let end = idx;
  while (start > 0 && text.charCodeAt(start - 1) !== 10) start--;
  while (end < text.length && text.charCodeAt(end) !== 10) end++;
  return text.slice(start, end);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** A capture that matches the *shape* of the value, so the anchor tracks future changes. */
function captureClass(value: string): string {
  if (/^[A-Za-z0-9][\w.+\-]*$/.test(value)) return "[\\w.+\\-]+";
  return `(?:${escapeRegExp(value)})`;
}

function suggestPattern(line: string, value: string): string {
  const i = line.indexOf(value);
  const prefix = line.slice(Math.max(0, i - 24), i).replace(/^\s+/, "");
  return escapeRegExp(prefix) + "(" + captureClass(value) + ")";
}

function escapePtr(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}

function findPointer(doc: unknown, target: string, base = ""): string | undefined {
  if (doc === null || doc === undefined) return undefined;
  if (typeof doc !== "object") {
    return String(doc) === target ? base || "/" : undefined;
  }
  if (Array.isArray(doc)) {
    for (let i = 0; i < doc.length; i++) {
      const r = findPointer(doc[i], target, `${base}/${i}`);
      if (r) return r;
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(doc)) {
    const r = findPointer(v, target, `${base}/${escapePtr(k)}`);
    if (r) return r;
  }
  return undefined;
}
