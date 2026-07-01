// Pure anchor resolvers: read or replace a value within file content.
// Each strategy is interchangeable; the engine dispatches on locator.kind.

// ---------- JSON Pointer (RFC 6901) ----------

function pointerParts(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function getJsonPointer(doc: unknown, pointer: string): unknown {
  const parts = pointerParts(pointer);
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setJsonPointer(doc: unknown, pointer: string, value: unknown): boolean {
  const parts = pointerParts(pointer);
  if (parts.length === 0) return false;
  let cur: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur === null || typeof cur !== "object") return false;
  (cur as Record<string, unknown>)[parts[parts.length - 1]] = value;
  return true;
}

// ---------- Region markers: <!-- yakir:NAME --> ... <!-- /yakir --> ----------

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionRe(name: string): RegExp {
  const n = escapeRegExp(name);
  return new RegExp(`(<!--\\s*yakir:${n}\\s*-->)([\\s\\S]*?)(<!--\\s*/yakir(?::${n})?\\s*-->)`);
}

export function getRegion(text: string, name: string): string | undefined {
  const m = regionRe(name).exec(text);
  return m ? m[2].trim() : undefined;
}

export function setRegion(text: string, name: string, value: string): string | undefined {
  const re = regionRe(name);
  if (!re.test(text)) return undefined;
  return text.replace(re, (_full, open: string, _inner: string, close: string) => `${open}${value}${close}`);
}

// ---------- Sets: a canonical string for a sorted-unique collection ----------

/**
 * Canonicalise a multiset of string tokens into one deterministic string, so a
 * *set* fact can flow through the same string-equality reconciliation as a scalar.
 * Drops anything in `allow`, de-duplicates, and sorts (numerically when every
 * surviving token is a number, else lexically). Returns "" for the empty set.
 */
export function canonicalSet(values: string[], allow: Array<string | number> = []): string {
  const deny = new Set(allow.map(String));
  const uniq = [...new Set(values.filter((v) => !deny.has(v)))];
  const numeric = uniq.length > 0 && uniq.every((v) => /^-?\d+(?:\.\d+)?$/.test(v));
  uniq.sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return uniq.join(", ");
}

// ---------- Pattern: a regexp whose first capture group is the value ----------

function patternRe(match: string, flags?: string): RegExp {
  const f = flags ?? "";
  return new RegExp(match, f.includes("d") ? f : f + "d");
}

function globalRe(match: string, flags?: string): RegExp {
  const f = flags ?? "";
  return new RegExp(match, f.includes("g") ? f : f + "g");
}

export function getPattern(text: string, match: string, flags?: string): string | undefined {
  const m = patternRe(match, flags).exec(text);
  if (!m) return undefined;
  return m[1] ?? m[0];
}

/**
 * Set-valued read: every match of `match`'s first capture group, canonicalised.
 * Returns undefined when nothing matches (a dangling anchor, like `getPattern`).
 */
export function getPatternAll(
  text: string,
  match: string,
  flags?: string,
  allow?: Array<string | number>,
): string | undefined {
  const out: string[] = [];
  for (const m of text.matchAll(globalRe(match, flags))) out.push(m[1] ?? m[0]);
  if (out.length === 0) return undefined;
  return canonicalSet(out, allow);
}

export function setPattern(text: string, match: string, value: string, flags?: string): string | undefined {
  const m = patternRe(match, flags).exec(text);
  if (!m) return undefined;
  const indices = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices;
  const span = indices?.[1] ?? indices?.[0];
  if (!span) return undefined;
  const [start, end] = span;
  return text.slice(0, start) + value + text.slice(end);
}
