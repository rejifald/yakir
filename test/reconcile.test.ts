import { describe, it, expect } from "vitest";
import { diagnose } from "../src/reconcile";
import type { Site, Tether } from "../src/spec";
import { siteKey } from "../src/spec";
import type { Extracted } from "../src/extract";
import type { TetherBaseline } from "../src/lockfile";
import { fingerprint } from "../src/fingerprint";

const pkg: Site = { artifact: "package.json", locator: { kind: "json-pointer", path: "/version" }, write: "manual" };
const readme: Site = { artifact: "README.md", locator: { kind: "region", name: "ver" }, write: "managed" };
const tether: Tether = { id: "ver", tier: "token", sites: [pkg, readme] };

function ext(pkgV: string | undefined, readmeV: string | undefined): Map<string, Extracted> {
  const m = new Map<string, Extracted>();
  m.set(siteKey(pkg), pkgV === undefined ? { value: undefined, error: "missing" } : { value: pkgV });
  m.set(siteKey(readme), readmeV === undefined ? { value: undefined, error: "missing" } : { value: readmeV });
  return m;
}

function baseline(value: string): TetherBaseline {
  return {
    baseline: value,
    sites: {
      [siteKey(pkg)]: { value, fp: fingerprint(value) },
      [siteKey(readme)]: { value, fp: fingerprint(value) },
    },
    accepted: null,
  };
}

describe("diagnose — token tier reconciliation", () => {
  it("fresh when all sites match the baseline", () => {
    expect(diagnose(tether, ext("1.0.0", "1.0.0"), baseline("1.0.0")).kind).toBe("fresh");
  });

  it("disagree on first sighting when sites differ", () => {
    expect(diagnose(tether, ext("1.0.0-rc.4", "1.0.0-rc.3"), undefined).kind).toBe("disagree");
  });

  it("fresh on first sighting when sites already agree", () => {
    expect(diagnose(tether, ext("1.0.0", "1.0.0"), undefined).kind).toBe("fresh");
  });

  it("rebased when all sites agree but the baseline is behind", () => {
    expect(diagnose(tether, ext("2.0.0", "2.0.0"), baseline("1.0.0")).kind).toBe("rebased");
  });

  it("autofix: a manual source moved, propagate into the managed site", () => {
    const d = diagnose(tether, ext("2.0.0", "1.0.0"), baseline("1.0.0"));
    expect(d.kind).toBe("autofix");
    if (d.kind === "autofix") {
      expect(d.winner).toBe("2.0.0");
      expect(d.writes).toHaveLength(1);
      expect(d.writes[0]!.site.artifact).toBe("README.md");
    }
  });

  it("blocked: the winning value would land in a read-only (manual) site", () => {
    // README (managed) was hand-edited; package.json (manual) lags → cannot rewrite package.json.
    expect(diagnose(tether, ext("1.0.0", "2.0.0"), baseline("1.0.0")).kind).toBe("blocked");
  });

  it("conflict: two sites changed to different values", () => {
    expect(diagnose(tether, ext("2.0.0", "3.0.0"), baseline("1.0.0")).kind).toBe("conflict");
  });

  it("integrity: a dangling anchor", () => {
    expect(diagnose(tether, ext("1.0.0", undefined), baseline("1.0.0")).kind).toBe("integrity");
  });

  it("discovered tethers stay warn-only (blocked) even when auto-fixable", () => {
    const d = diagnose({ ...tether, origin: "discovered" }, ext("2.0.0", "1.0.0"), baseline("1.0.0"));
    expect(d.kind).toBe("blocked");
  });
});
