import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "../src/spec";
import { emptyLock } from "../src/lockfile";
import type { Lockfile } from "../src/lockfile";
import { check, fix } from "../src/engine";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tether-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const manifest: Manifest = {
  tethers: [
    {
      id: "release-version",
      tier: "token",
      policy: { severity: "warn" },
      sites: [
        { artifact: "package.json", locator: { kind: "json-pointer", path: "/version" }, write: "manual" },
        { artifact: "README.md", locator: { kind: "region", name: "ver" }, write: "managed" },
      ],
    },
  ],
};

function writePkg(v: string): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: v }, null, 2) + "\n");
}
function writeReadme(v: string): void {
  writeFileSync(join(root, "README.md"), `# x\n\nAt <!-- tether:ver -->${v}<!-- /tether --> now.\n`);
}
function readmeText(): string {
  return readFileSync(join(root, "README.md"), "utf8");
}

describe("engine — the StitchAPI release-version case", () => {
  it("detects existing drift on adoption (README lags package.json)", () => {
    writePkg("1.0.0-rc.4");
    writeReadme("1.0.0-rc.3");
    const report = check(manifest, root, emptyLock());
    expect(report.findings[0]!.status).toBe("disagree");
    expect(report.ok).toBe(true); // default severity warn → reported, not blocking
  });

  it("auto-fixes the managed README when the manual package.json moves", () => {
    writePkg("1.0.0-rc.4");
    writeReadme("1.0.0-rc.4");
    const lock: Lockfile = emptyLock();
    expect(fix(manifest, root, lock).findings[0]!.status).toBe("fresh"); // first run records baseline
    writePkg("1.0.0-rc.5"); // the source moves
    const report = fix(manifest, root, lock);
    expect(report.findings[0]!.status).toBe("fixed");
    expect(readmeText()).toContain("1.0.0-rc.5");
    expect(lock.tethers["release-version"]!.baseline).toBe("1.0.0-rc.5");
  });

  it("never rewrites the manual package.json from a README typo", () => {
    writePkg("1.0.0-rc.4");
    writeReadme("1.0.0-rc.4");
    const lock: Lockfile = emptyLock();
    fix(manifest, root, lock); // baseline rc.4
    writeReadme("9.9.9"); // fat-finger the managed site
    const report = fix(manifest, root, lock);
    expect(report.findings[0]!.status).toBe("drifted"); // blocked, not applied
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain("1.0.0-rc.4"); // untouched
  });
});
