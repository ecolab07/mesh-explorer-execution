import { createHash } from "node:crypto";

export function canonicalStringify(value: unknown): string {
  const serialized = serializeCanonical(value, new Set<object>());
  if (serialized === undefined) {
    throw new TypeError("Top-level undefined is not supported in canonicalStringify");
  }
  return serialized;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function serializeCanonical(value: unknown, seen: Set<object>): string | undefined {
  if (value === null) return "null";

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }
  if (valueType === "undefined") {
    return undefined;
  }
  if (valueType === "bigint") {
    throw new TypeError("BigInt is not supported in canonicalStringify");
  }
  if (valueType === "function" || valueType === "symbol") {
    return undefined;
  }

  if (!(value instanceof Object)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    throw new TypeError("Date is not supported in canonicalStringify");
  }
  if (seen.has(value)) {
    throw new TypeError("Cannot canonicalize cyclic structures");
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCanonical(item, seen) ?? "null");
    seen.delete(value);
    return `[${items.join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    const serialized = serializeCanonical(objectValue[key], seen);
    if (serialized !== undefined) {
      pairs.push(`${JSON.stringify(key)}:${serialized}`);
    }
  }

  seen.delete(value);
  return `{${pairs.join(",")}}`;
}
