import { createHash } from "node:crypto";
import type { ProjectionSnapshot } from "@mesh/projection-minimal";

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

const VOLATILE_KEYS = new Set(["createdAt", "updatedAt", "timestamp"]);

function sortByStableId(values: CanonicalJson[]): CanonicalJson[] {
  const canSortById =
    values.length > 0 &&
    values.every((entry) => {
      if (!entry || Array.isArray(entry) || typeof entry !== "object") return false;
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" || typeof id === "number";
    });

  if (!canSortById) {
    return values;
  }

  return [...values].sort((a, b) => {
    const aId = String((a as { id: string | number }).id);
    const bId = String((b as { id: string | number }).id);
    return aId.localeCompare(bId);
  });
}

function canonicalizeProjection(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const canonicalValues = value.map((entry) => canonicalizeProjection(entry));
    return sortByStableId(canonicalValues);
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue)
      .filter((key) => !VOLATILE_KEYS.has(key))
      .sort((a, b) => a.localeCompare(b));

    return sortedKeys.reduce<Record<string, CanonicalJson>>((acc, key) => {
      acc[key] = canonicalizeProjection(objectValue[key]);
      return acc;
    }, {});
  }

  return String(value);
}

export function projectionCanonicalDump(snapshot: ProjectionSnapshot): string {
  return JSON.stringify(canonicalizeProjection(snapshot));
}

export function projectionDigest(snapshot: ProjectionSnapshot): string {
  return createHash("sha256").update(projectionCanonicalDump(snapshot)).digest("hex");
}

export type ProjectionDeterminismEvidence = {
  label: string;
  cursor: number;
  projectionDigest: string;
  canonicalDump: string;
};

export function projectionEvidence(label: string, snapshot: ProjectionSnapshot): ProjectionDeterminismEvidence {
  return {
    label,
    cursor: snapshot.cursor,
    projectionDigest: projectionDigest(snapshot),
    canonicalDump: projectionCanonicalDump(snapshot)
  };
}

export function assertProjectionDeterminism(expected: ProjectionDeterminismEvidence, observed: ProjectionDeterminismEvidence): void {
  if (expected.projectionDigest === observed.projectionDigest) {
    return;
  }

  throw new Error(
    [
      "Projection determinism mismatch.",
      `expected=${JSON.stringify({ cursor: expected.cursor, projectionDigest: expected.projectionDigest })}`,
      `observed=${JSON.stringify({ cursor: observed.cursor, projectionDigest: observed.projectionDigest })}`,
      `expectedDump=${expected.canonicalDump}`,
      `observedDump=${observed.canonicalDump}`
    ].join("\n")
  );
}
