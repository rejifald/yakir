export * from "./spec";
export * from "./lockfile";
export { extractSite, writeSite, extractAll } from "./extract";
export type { Extracted } from "./extract";
export { diagnose } from "./reconcile";
export type { Diagnosis, WriteAction } from "./reconcile";
export { check, fix, accept } from "./engine";
export type { Report, Finding, FindingStatus } from "./engine";
export { expandTether } from "./expand";
export type { ExpandResult } from "./expand";
export { fingerprint } from "./fingerprint";
export {
  getJsonPointer,
  setJsonPointer,
  getRegion,
  setRegion,
  getPattern,
  getPatternAll,
  setPattern,
  canonicalSet,
  escapeRegExp,
} from "./locators";
export { walkFiles, globToRegExp, findValueSites, seedValuesForTether } from "./discover";
export type { Candidate, WalkOptions, DiscoverOptions } from "./discover";
