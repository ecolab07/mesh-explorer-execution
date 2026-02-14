declare module "node:fs" {
  export const promises: any;
}

declare module "node:os" {
  const os: any;
  export default os;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare const process: { env: Record<string, string | undefined> };
