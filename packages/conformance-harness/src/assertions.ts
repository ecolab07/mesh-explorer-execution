import type { CommandOutcome } from "@mesh/shared";
import type { CanonicalStateDump } from "./canonicalStateDump.js";
import type { Normalizer } from "./normalizer.js";

/** spec-ref: Mesh_Execution_Compiled_v_1.md §15, §16.3 */
export function assertReceiptEqual(a: CommandOutcome, b: CommandOutcome, normalizer: Normalizer): void {
  if (normalizer.canonicalString(a) !== normalizer.canonicalString(b)) {
    throw new Error("Receipt mismatch under canonical normalization");
  }
}

export function assertDumpEqual(a: CanonicalStateDump, b: CanonicalStateDump, normalizer: Normalizer): void {
  if (normalizer.canonicalString(a) !== normalizer.canonicalString(b)) {
    throw new Error("CanonicalStateDump mismatch");
  }
}
