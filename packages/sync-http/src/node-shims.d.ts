declare module "node:http" {
  export const createServer: any;
  export type IncomingMessage = any;
  export type ServerResponse = any;
}

declare module "node:events" {
  export const once: any;
}
