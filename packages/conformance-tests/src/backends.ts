import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { InMemoryLocalEventStore, makePersistentEventStore } from "@mesh/eventstore-local";

export type ConformanceBackend = "inmemory" | "persistent";

export function getConformanceBackends(): ConformanceBackend[] {
  const requested = process.env.MESH_BACKEND?.trim().toLowerCase();
  if (requested === "persistent") return ["persistent"];
  if (requested === "all") return ["inmemory", "persistent"];
  return ["inmemory"];
}

type StoreContext = {
  store: LocalEventStore;
  reopen: () => Promise<LocalEventStore>;
  cleanup: () => Promise<void>;
};

export async function makeStore(backend: ConformanceBackend): Promise<StoreContext> {
  if (backend === "inmemory") {
    return {
      store: new InMemoryLocalEventStore(),
      reopen: async () => new InMemoryLocalEventStore(),
      cleanup: async () => {}
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-persistent-store-"));
  const filePath = path.join(tmpDir, "eventstore.json");
  let current = await makePersistentEventStore(filePath);

  return {
    store: current,
    reopen: async () => {
      current = await makePersistentEventStore(filePath);
      return current;
    },
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  };
}
