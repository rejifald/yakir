import { describe, it, expect } from "vitest";
import { getRegion, setRegion, getPattern, setPattern, getJsonPointer, setJsonPointer } from "../src/locators";

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

describe("json pointer", () => {
  it("reads a nested value", () => expect(getJsonPointer({ a: { b: 2 } }, "/a/b")).toBe(2));
  it("writes a nested value", () => {
    const doc = { version: "1.0.0" };
    expect(setJsonPointer(doc, "/version", "2.0.0")).toBe(true);
    expect(doc.version).toBe("2.0.0");
  });
});
