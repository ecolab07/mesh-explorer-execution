export {};

declare module "vitest" {
  interface TaskMeta {
    invariantId?: string;
    surface?: string;
    oracle?: string;
    criticality?: "Critical" | "Structural" | "Regression";
  }
}
