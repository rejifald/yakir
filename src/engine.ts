import type { Manifest, Tether, Severity } from "./spec";
import { extractAll, writeSite } from "./extract";
import { diagnose } from "./reconcile";
import type { WriteAction } from "./reconcile";
import type { Lockfile } from "./lockfile";

export type FindingStatus =
  | "fresh"
  | "rebased"
  | "fixed"
  | "drifted"
  | "conflict"
  | "disagree"
  | "integrity";

export interface Finding {
  tetherId: string;
  tier: string;
  severity: Severity;
  status: FindingStatus;
  message: string;
  writes: WriteAction[];
  applied: boolean;
  integrity?: string[];
}

export interface Report {
  findings: Finding[];
  ok: boolean;
  summary: Record<FindingStatus, number>;
}

function severityOf(t: Tether): Severity {
  return t.policy?.severity ?? "warn";
}

function blocking(f: Finding): boolean {
  if (f.status === "fresh" || f.status === "rebased" || f.status === "fixed") return false;
  if (f.status === "integrity") return true; // a broken anchor always needs attention
  return f.severity === "block";
}

function summarize(findings: Finding[]): Report {
  const summary: Record<FindingStatus, number> = {
    fresh: 0,
    rebased: 0,
    fixed: 0,
    drifted: 0,
    conflict: 0,
    disagree: 0,
    integrity: 0,
  };
  for (const f of findings) summary[f.status]++;
  return { findings, ok: !findings.some(blocking), summary };
}

function finding(
  t: Tether,
  status: FindingStatus,
  message: string,
  writes: WriteAction[],
  applied = false,
): Finding {
  return { tetherId: t.id, tier: t.tier ?? "token", severity: severityOf(t), status, message, writes, applied };
}

function integrityFinding(t: Tether, problems: string[]): Finding {
  return {
    ...finding(t, "integrity", `anchor integrity: ${problems.join("; ")}`, []),
    integrity: problems,
  };
}

function values(d: { values: string[] }): string {
  return d.values.map((v) => `"${v}"`).join(" vs ");
}

/** Read-only: report drift, never touch files or the lock. */
export function check(manifest: Manifest, root: string, lock: Lockfile): Report {
  const findings = manifest.tethers.map((t): Finding => {
    const d = diagnose(t, extractAll(root, t), lock.tethers[t.id]);
    switch (d.kind) {
      case "fresh":
        return finding(t, "fresh", "in sync", []);
      case "rebased":
        return finding(t, "rebased", `all sites agree on "${d.commonValue}"; baseline is behind (run \`yakir fix\`)`, []);
      case "autofix":
        return finding(t, "drifted", `auto-fixable: propagate "${d.winner}" to ${d.writes.length} site(s) (run \`yakir fix\`)`, d.writes);
      case "blocked":
        return finding(t, "drifted", d.reason, d.writes);
      case "conflict":
        return finding(t, "conflict", `${d.reason}: ${values(d)}`, []);
      case "disagree":
        return finding(t, "disagree", `${d.reason}: ${values(d)}`, []);
      case "integrity":
        return integrityFinding(t, d.problems);
    }
  });
  return summarize(findings);
}

/** Apply auto-fixes and advance the baseline. Mutates `lock`. */
export function fix(manifest: Manifest, root: string, lock: Lockfile): Report {
  const findings = manifest.tethers.map((t): Finding => {
    const d = diagnose(t, extractAll(root, t), lock.tethers[t.id]);
    switch (d.kind) {
      case "fresh":
        lock.tethers[t.id] = d.nextBaseline;
        return finding(t, "fresh", "in sync", []);
      case "rebased":
        lock.tethers[t.id] = d.nextBaseline;
        return finding(t, "rebased", `baseline advanced to "${d.commonValue}"`, [], true);
      case "autofix": {
        const failures: string[] = [];
        for (const w of d.writes) {
          const r = writeSite(root, w.site, w.to);
          if (!r.ok) failures.push(`${w.site.artifact}: ${r.error}`);
        }
        if (failures.length > 0) return integrityFinding(t, failures);
        lock.tethers[t.id] = d.nextBaseline;
        return finding(t, "fixed", `propagated "${d.winner}" to ${d.writes.length} site(s)`, d.writes, true);
      }
      case "blocked":
        return finding(t, "drifted", d.reason, d.writes);
      case "conflict":
        return finding(t, "conflict", `${d.reason}: ${values(d)}`, []);
      case "disagree":
        return finding(t, "disagree", `${d.reason}: ${values(d)}`, []);
      case "integrity":
        return integrityFinding(t, d.problems);
    }
  });
  return summarize(findings);
}

/** Re-baseline the current state, asserting the sites agree. Mutates `lock`. */
export function accept(
  manifest: Manifest,
  root: string,
  lock: Lockfile,
  opts: { tetherId?: string; meta?: AcceptMetaInput } = {},
): Report {
  const targets = manifest.tethers.filter((t) => !opts.tetherId || t.id === opts.tetherId);
  const findings = targets.map((t): Finding => {
    const d = diagnose(t, extractAll(root, t), lock.tethers[t.id]);
    if (d.kind === "integrity") return integrityFinding(t, d.problems);
    if (d.kind === "conflict" || d.kind === "disagree") {
      return finding(t, d.kind, `cannot accept while sites disagree (${values(d)}); fix them first`, []);
    }
    if (d.kind !== "fresh" && d.kind !== "rebased") {
      return finding(t, "disagree", "sites currently differ; run `yakir fix` or reconcile them before accepting", []);
    }
    const next = d.nextBaseline;
    next.accepted = { ...(opts.meta ?? {}) };
    lock.tethers[t.id] = next;
    return finding(t, "fresh", "accepted current state as the baseline", [], true);
  });
  return summarize(findings);
}

type AcceptMetaInput = { at?: string; by?: string; reason?: string };
