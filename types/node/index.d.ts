declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: "hex"): string };
    digest(encoding: "hex"): string;
  };
}

declare module "node:events" {
  export function once(emitter: { once(event: string, listener: (...args: unknown[]) => void): unknown }, event: string): Promise<unknown[]>;
}

declare module "node:fs" {
  export const promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
  };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function pathToFileURL(path: string): { href: string };
}

declare module "node:http" {
  export type IncomingHttpHeaders = Record<string, string | string[] | undefined>;

  export interface IncomingMessage extends AsyncIterable<string | Uint8Array> {
    url?: string;
    method?: string;
    headers: IncomingHttpHeaders;
    on(event: "data", listener: (chunk: string | Uint8Array) => void): this;
    on(event: "end" | "error" | "close", listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface ServerResponse {
    writableEnded: boolean;
    statusCode: number;
    setHeader(name: string, value: string): void;
    write(chunk: string | Uint8Array): boolean;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(chunk?: string): void;
    once(event: string, listener: () => void): unknown;
  }

  export interface AddressInfo {
    port: number;
  }

  export interface Server {
    listening: boolean;
    listen(port?: number, host?: string): void;
    address(): AddressInfo | string | null;
    close(): void;
    once(event: string, listener: () => void): unknown;
  }

  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  stdout: { write(text: string): void };
};

declare const Buffer: {
  from(input: string | ArrayBufferLike | Uint8Array): { toString(encoding?: string): string } & Uint8Array;
};
