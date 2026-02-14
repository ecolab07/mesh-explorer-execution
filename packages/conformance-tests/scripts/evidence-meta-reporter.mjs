import { promises as fs } from "node:fs";

function collectTasks(task, out, filePath) {
  if (!task) return;
  if (task.type === "test") {
    out.push({
      file: filePath,
      name: task.name,
      meta: task.meta ?? {},
      annotations: task.result?.annotations ?? []
    });
    return;
  }

  for (const child of task.tasks ?? []) {
    collectTasks(child, out, filePath);
  }
}

export default class EvidenceMetaReporter {
  async onFinished(files = []) {
    const outputPath = process.env.MESH_EVIDENCE_META_PATH;
    if (!outputPath) {
      throw new Error("MESH_EVIDENCE_META_PATH is required for EvidenceMetaReporter");
    }

    const tests = [];
    for (const file of files) {
      collectTasks(file, tests, file.filepath);
    }

    await fs.writeFile(outputPath, `${JSON.stringify(tests, null, 2)}\n`, "utf8");
  }
}
