import { spawn } from "node:child_process";

const processes = [
  { name: "backend", color: "\x1b[32m", command: "pnpm", args: ["graph-server"] },
  { name: "proxy", color: "\x1b[35m", command: "pnpm", args: ["dev:transport-proxy"] },
  { name: "web", color: "\x1b[36m", command: "pnpm", args: ["dev:web"] },
  { name: "web-proxy", color: "\x1b[33m", command: "pnpm", args: ["dev:web:proxy"] }
];

const reset = "\x1b[0m";
const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const lines = chunk.toString().split(/\r?\n/);
  return lines
    .filter((line) => line.length > 0)
    .map((line) => `${color}[${name}]${reset} ${line}`)
    .join("\n");
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 150);
}

for (const proc of processes) {
  const child = spawn(proc.command, proc.args, {
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  children.push(child);

  child.stdout.on("data", (chunk) => {
    const text = prefix(proc.name, proc.color, chunk);
    if (text) process.stdout.write(`${text}\n`);
  });
  child.stderr.on("data", (chunk) => {
    const text = prefix(proc.name, proc.color, chunk);
    if (text) process.stderr.write(`${text}\n`);
  });

  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`${proc.color}[${proc.name}]${reset} exited with code ${code}. Stopping dev lab.`);
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
