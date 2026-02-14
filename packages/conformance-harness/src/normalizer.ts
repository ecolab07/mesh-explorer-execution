import { canonicalString, stripNondeterminism } from "@mesh/shared";

/** spec-ref: Mesh_Execution_Compiled_v_1.md §15 */
export interface Normalizer {
  canonicalString(value: unknown): string;
  stripNondeterminism<T>(value: T): T;
}

export class DefaultNormalizer implements Normalizer {
  canonicalString(value: unknown): string {
    return canonicalString(value);
  }

  stripNondeterminism<T>(value: T): T {
    return stripNondeterminism(value);
  }
}
