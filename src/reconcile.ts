import type { Tether } from "./spec";
import { siteKey, siteWrite, siteLabel, isMeasuredOrSet } from "./spec";
import type { Site } from "./spec";
import { fingerprint } from "./fingerprint";
import type { Extracted } from "./extract";
import type { TetherBaseline, AcceptMeta } from "./lockfile";

export interface WriteAction {
  site: Site;
  siteKey: string;
  from: string | undefined;
  to: string;
}

export type Diagnosis =
  | { kind: "fresh"; nextBaseline: TetherBaseline }
  | { kind: "rebased"; nextBaseline: TetherBaseline; commonValue: string }
  | { kind: "autofix"; nextBaseline: TetherBaseline; winner: string; writes: WriteAction[] }
  /** Drift in a measured/set tether: detected and reported, never auto-written. */
  | { kind: "report"; reason: string; winner: string; writes: WriteAction[] }
  | { kind: "blocked"; reason: string; writes: WriteAction[] }
  | { kind: "conflict"; reason: string; values: string[] }
  | { kind: "disagree"; reason: string; values: string[] }
  | { kind: "integrity"; problems: string[] };

/**
 * The pure heart: given a tether, the current value at each site, and the prior
 * baseline, decide what state the tether is in and how it would reconcile.
 *
 * Detection is fully symmetric — a change at *any* site is a signal. The only
 * asymmetry is the per-site write capability, applied in case 3.
 */
export function diagnose(
  tether: Tether,
  extracted: Map<string, Extracted>,
  prior: TetherBaseline | undefined,
): Diagnosis {
  const sites = tether.sites;

  // 0. Inventory integrity: every anchor must resolve, or we cannot reason.
  const problems: string[] = [];
  for (const s of sites) {
    const ex = extracted.get(siteKey(s));
    if (!ex || ex.error) problems.push(`${siteLabel(s)}: ${ex?.error ?? "no extraction"}`);
  }
  if (problems.length > 0) return { kind: "integrity", problems };

  const values = new Map<string, string>();
  for (const s of sites) values.set(siteKey(s), extracted.get(siteKey(s))!.value!);

  const accepted: AcceptMeta | null = prior?.accepted ?? null;
  const uniformBaseline = (value: string): TetherBaseline => ({
    baseline: value,
    sites: Object.fromEntries(sites.map((s) => [siteKey(s), { value, fp: fingerprint(value) }])),
    accepted,
  });
  const snapshotBaseline = (base: string | null): TetherBaseline => ({
    baseline: base,
    sites: Object.fromEntries(
      sites.map((s) => {
        const v = values.get(siteKey(s))!;
        return [siteKey(s), { value: v, fp: fingerprint(v) }];
      }),
    ),
    accepted,
  });

  const distinct = new Set(values.values());

  // 1. No usable baseline yet — first sighting.
  if (!prior || prior.baseline === null) {
    if (distinct.size === 1) return { kind: "fresh", nextBaseline: snapshotBaseline([...distinct][0]!) };
    return { kind: "disagree", reason: "no baseline yet and sites disagree", values: [...distinct] };
  }

  const base = prior.baseline;
  const changed = sites.filter((s) => values.get(siteKey(s)) !== base);

  // 2a. Everyone still matches the baseline.
  if (changed.length === 0) return { kind: "fresh", nextBaseline: snapshotBaseline(base) };

  // 2b. Everyone agrees with each other but differs from the baseline → consistent update.
  if (distinct.size === 1) {
    const common = [...distinct][0]!;
    return { kind: "rebased", nextBaseline: uniformBaseline(common), commonValue: common };
  }

  // 3. Exactly one new value → that is the truth; propagate to the laggards.
  const changedValues = new Set(changed.map((s) => values.get(siteKey(s))!));
  if (changedValues.size === 1) {
    const winner = [...changedValues][0]!;
    const lagging = sites.filter((s) => values.get(siteKey(s)) !== winner);
    const writes: WriteAction[] = lagging.map((s) => ({
      site: s,
      siteKey: siteKey(s),
      from: values.get(siteKey(s)),
      to: winner,
    }));
    // Measured/set tethers are detect-and-report: never auto-rewrite a measured
    // value or a set of numbers in prose. The drift is still surfaced (and blocking).
    if (sites.some(isMeasuredOrSet)) {
      return {
        kind: "report",
        winner,
        writes,
        reason: `measured value is "${winner}"; ${writes.length} site(s) disagree — re-measure and update`,
      };
    }
    const manualTarget = lagging.some((s) => siteWrite(s) === "manual");
    const discovered = (tether.origin ?? "declared") === "discovered";
    if (manualTarget) {
      return {
        kind: "blocked",
        reason: `the new value "${winner}" would have to be written into a read-only (manual) site`,
        writes,
      };
    }
    if (discovered) {
      return { kind: "blocked", reason: "discovered tether is warn-only until accepted into the manifest", writes };
    }
    return { kind: "autofix", winner, writes, nextBaseline: uniformBaseline(winner) };
  }

  // 4. Two or more divergent new values → a genuine conflict.
  return { kind: "conflict", reason: "two or more sites changed to different values", values: [...changedValues] };
}
