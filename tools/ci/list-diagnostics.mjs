import fs from "node:fs";

const paths = ["artifacts", "packages/conformance-tests"];

for (const targetPath of paths) {
  console.log("[diagnostics] " + targetPath);

  if (!fs.existsSync(targetPath)) {
    console.log("  <missing>");
    continue;
  }

  for (const entry of fs.readdirSync(targetPath).sort()) {
    console.log("  - " + entry);
  }
}
