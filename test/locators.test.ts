import { describe, it, expect } from "vitest";
import {
  getRegion,
  setRegion,
  getPattern,
  getPatternAll,
  setPattern,
  getJsonPointer,
  setJsonPointer,
  canonicalSet,
} from "../src/locators";

describe("region markers", () => {
  const text = "version: <!-- tether:ver -->1.0.0-rc.3<!-- /tether --> ok";
  it("extracts the inner value", () => expect(getRegion(text, "ver")).toBe("1.0.0-rc.3"));
  it("replaces only the inner span", () => {
    expect(setRegion(text, "ver", "1.0.0-rc.4")).toBe("version: <!-- tether:ver -->1.0.0-rc.4<!-- /tether --> ok");
  });
  it("returns undefined for a missing marker", () => expect(getRegion(text, "nope")).toBeUndefined());
});

describe("pattern with a capture group", () => {
  const text = "StitchAPI is at `1.0.0-rc.3` today";
  const re = "StitchAPI is at `([0-9a-zA-Z.\\-]+)`";
  it("extracts the first group", () => expect(getPattern(text, re)).toBe("1.0.0-rc.3"));
  it("replaces only the captured group", () => {
    expect(setPattern(text, re, "1.0.0-rc.4")).toBe("StitchAPI is at `1.0.0-rc.4` today");
  });
});

describe("canonicalSet", () => {
  it("sorts numerically, de-duplicates, and joins", () => {
    expect(canonicalSet(["24", "19", "19"])).toBe("19, 24");
  });
  it("drops allow-listed values", () => {
    expect(canonicalSet(["24", "64", "20", "19"], [64, 20])).toBe("19, 24");
  });
  it("sorts lexically when not all-numeric", () => {
    expect(canonicalSet(["beta", "alpha", "beta"])).toBe("alpha, beta");
  });
  it("is empty for an all-filtered set", () => {
    expect(canonicalSet(["64", "20"], [64, 20])).toBe("");
  });
});

describe("set-valued pattern (all + allow)", () => {
  // The StitchAPI advertised-bundle-size token, tolerating &nbsp; / %20 separators.
  const match = "~(?:\\s|&nbsp;|%20)*(\\d+)(?:\\s|&nbsp;|%20)*kB";
  it("captures every occurrence as a sorted-unique set", () => {
    const text = "badge ~24%20kB … entry ~24&nbsp;kB, import ~19 kB";
    expect(getPatternAll(text, match)).toBe("19, 24");
  });
  it("honours a per-file allow list (raw / brotli figures)", () => {
    const text = "~24 kB min+gzip (~64 kB raw, ~20 kB brotli); import ~19 kB";
    expect(getPatternAll(text, match, undefined, [64, 20])).toBe("19, 24");
  });
  it("returns undefined when nothing matches (a dangling anchor)", () => {
    expect(getPatternAll("no sizes here", match)).toBeUndefined();
  });
});

describe("json pointer", () => {
  it("reads a nested value", () => expect(getJsonPointer({ a: { b: 2 } }, "/a/b")).toBe(2));
  it("writes a nested value", () => {
    const doc = { version: "1.0.0" };
    expect(setJsonPointer(doc, "/version", "2.0.0")).toBe(true);
    expect(doc.version).toBe("2.0.0");
  });
});
