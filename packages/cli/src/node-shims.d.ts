declare module "node:fs/promises" {
  export const access: any;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare const process: {
  argv: string[];
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
  exit: (code?: number) => never;
};
