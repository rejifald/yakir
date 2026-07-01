import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Site, Tether } from "./spec";
import { isGlobArtifact } from "./spec";
import { walkFiles, globToRegExp } from "./discover";

export interface ExpandResult {
  tether: Tether;
  /** Non-empty when a glob site matched nothing — a broken anchor (inventory integrity). */
  problems: string[];
}

function isDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a repo-relative glob to matching files. Walks segment by segment so a
 * per-package-manifest pattern only reads `packages/` and stats each candidate — it
 * never descends into `src/`, keeping pre-commit checks fast. A `**` segment (rare)
 * falls back to a full tree walk filtered by the whole pattern.
 */
function resolveGlob(root: string, pattern: string): string[] {
  if (pattern.includes("**")) {
    const re = globToRegExp(pattern);
    return walkFiles(root)
      .map((abs) => relative(root, abs).split(sep).join("/"))
      .filter((f) => re.test(f));
  }
  const segments = pattern.split("/");
  let dirs: string[] = [""]; // repo-relative dirs matched so far ("" = root)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const last = i === segments.length - 1;
    const wild = /[*?]/.test(seg);
    const next: string[] = [];
    for (const d of dirs) {
      if (!wild) {
        const rel = d ? `${d}/${seg}` : seg;
        const abs = join(root, rel);
        if (last ? isFile(abs) : isDir(abs)) next.push(rel);
        continue;
      }
      const re = globToRegExp(seg);
      let entries;
      try {
        entries = readdirSync(join(root, d), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!re.test(e.name)) continue;
        if (last ? e.isFile() : e.isDirectory()) next.push(d ? `${d}/${e.name}` : e.name);
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * Expand any glob `artifact` into one concrete co-equal site per matching file.
 * A monorepo fact ("every package.json is at this version") becomes N sites without
 * hand-listing them, and a newly-added package is covered automatically. Non-glob
 * sites (and command sites) pass through untouched.
 */
export function expandTether(root: string, tether: Tether): ExpandResult {
  if (!tether.sites.some((s) => isGlobArtifact(s.artifact))) return { tether, problems: [] };

  const problems: string[] = [];
  const sites: Site[] = [];
  for (const s of tether.sites) {
    if (!isGlobArtifact(s.artifact)) {
      sites.push(s);
      continue;
    }
    const excludes = (s.exclude ?? []).map(globToRegExp);
    const matches = resolveGlob(root, s.artifact!)
      .filter((f) => !excludes.some((re) => re.test(f)))
      .sort();
    if (matches.length === 0) {
      problems.push(`glob site matched no files: ${s.artifact}`);
      continue;
    }
    for (const f of matches) sites.push({ artifact: f, locator: s.locator, write: s.write });
  }
  return { tether: { ...tether, sites }, problems };
}
