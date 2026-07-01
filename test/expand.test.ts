import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest, Tether } from "../src/spec";
import { expandTether } from "../src/expand";
import { emptyLock } from "../src/lockfile";
import { check } from "../src/engine";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "yakir-glob-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function pkg(name: string, version: string): void {
  const dir = join(root, "packages", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, private: name === "internal" }, null, 2) + "\n");
}

const globTether: Tether = {
  id: "version-lockstep",
  tier: "token",
  policy: { severity: "block" },
  sites: [
    {
      artifact: "packages/*/package.json",
      exclude: ["packages/internal/**"],
      locator: { kind: "json-pointer", path: "/version" },
      write: "manual",
    },
  ],
};

describe("glob-sites — expandTether", () => {
  it("expands one glob site into one site per matching file (sorted), minus excludes", () => {
    pkg("alpha", "1.0.0");
    pkg("beta", "1.0.0");
    pkg("internal", "0.0.0"); // excluded
    const { tether, problems } = expandTether(root, globTether);
    expect(problems).toEqual([]);
    expect(tether.sites.map((s) => s.artifact)).toEqual([
      "packages/alpha/package.json",
      "packages/beta/package.json",
    ]);
    // each expanded site keeps the original locator + write cap
    expect(tether.sites[0]!.locator).toEqual({ kind: "json-pointer", path: "/version" });
    expect(tether.sites[0]!.write).toBe("manual");
  });

  it("flags a glob that matches nothing as an integrity problem", () => {
    const { problems } = expandTether(root, globTether);
    expect(problems[0]).toMatch(/matched no files/);
  });

  it("leaves a non-glob tether untouched", () => {
    const plain: Tether = { id: "x", sites: [{ artifact: "README.md", locator: { kind: "region", name: "v" } }] };
    expect(expandTether(root, plain).tether).toBe(plain);
  });
});

describe("glob-sites — end-to-end lockstep", () => {
  const manifest: Manifest = { tethers: [globTether] };

  it("is in sync when every matched package agrees", () => {
    pkg("alpha", "1.0.0");
    pkg("beta", "1.0.0");
    pkg("internal", "9.9.9"); // excluded → ignored
    expect(check(manifest, root, emptyLock()).findings[0]!.status).toBe("fresh");
  });

  it("catches a package that lagged the lockstep bump", () => {
    pkg("alpha", "2.0.0");
    pkg("beta", "2.0.0");
    pkg("gamma", "1.0.0"); // forgot to bump
    const report = check(manifest, root, emptyLock());
    expect(report.findings[0]!.status).toBe("disagree");
    expect(report.ok).toBe(false); // severity block
  });

  it("reports integrity when the glob matches nothing", () => {
    // no packages/ at all
    expect(check(manifest, root, emptyLock()).findings[0]!.status).toBe("integrity");
  });
});
