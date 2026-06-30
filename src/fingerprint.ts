import { createHash } from "node:crypto";

/** Opaque content fingerprint used to detect change at a site. */
export function fingerprint(value: string): string {
  return "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");
}
