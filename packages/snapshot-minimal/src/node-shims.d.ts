declare module "node:fs" {
  export const promises: any;
}

declare module "node:path" {
  const path: any;
  export default path;
}
