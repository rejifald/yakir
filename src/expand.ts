import { relative, sep } from "node:path";
import type { Site, Tether } from "./spec";
import { isGlobArtifact } from "./spec";
import { walkFiles, globToRegExp } from "./discover";

export interface ExpandResult {
  tether: Tether;
  /** Non-empty when a glob site matched nothing — a broken anchor (inventory integrity). */
  problems: string[];
}

/**
 * Expand any glob `artifact` into one concrete co-equal site per matching file.
 * A monorepo fact ("every package.json is at this version") becomes N sites without
 * hand-listing them, and a newly-added package is covered automatically. Non-glob
 * sites (and command sites) pass through untouched.
 */
export function expandTether(root: string, tether: Tether): ExpandResult {
  if (!tether.sites.some((s) => isGlobArtifact(s.artifact))) return { tether, problems: [] };

  const files = walkFiles(root).map((abs) => relative(root, abs).split(sep).join("/"));
  const problems: string[] = [];
  const sites: Site[] = [];
  for (const s of tether.sites) {
    if (!isGlobArtifact(s.artifact)) {
      sites.push(s);
      continue;
    }
    const include = globToRegExp(s.artifact!);
    const excludes = (s.exclude ?? []).map(globToRegExp);
    const matches = files.filter((f) => include.test(f) && !excludes.some((re) => re.test(f))).sort();
    if (matches.length === 0) {
      problems.push(`glob site matched no files: ${s.artifact}`);
      continue;
    }
    for (const f of matches) sites.push({ artifact: f, locator: s.locator, write: s.write });
  }
  return { tether: { ...tether, sites }, problems };
}
