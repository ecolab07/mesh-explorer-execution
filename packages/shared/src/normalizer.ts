/** spec-ref: Mesh_Execution_Compiled_v_1.md §14, §15 */
const NON_DETERMINISTIC_KEYS = new Set(["createdAt", "timestamp"]);

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, unknown>>((acc, key) => {
      if (NON_DETERMINISTIC_KEYS.has(key)) {
        return acc;
      }
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return sortObject(value as Record<string, unknown>);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    // TODO(spec-ref: §14.1 rule 4): reject vs normalize is left to backend policy.
    return String(value);
  }

  return value;
}

export function stripNondeterminism<T>(value: T): T {
  return canonicalize(structuredClone(value)) as T;
}

export function canonicalString(value: unknown): string {
  return JSON.stringify(stripNondeterminism(value));
}
