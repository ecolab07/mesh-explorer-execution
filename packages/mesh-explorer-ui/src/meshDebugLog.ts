type MeshDebugLogger = { log?: (message: string, detail?: unknown) => void };

type MeshDebugWindow = Window & { __meshDebug?: MeshDebugLogger };

type EmitMeshDebugLogOptions = {
  devMode: boolean;
  consoleInfo?: (message?: unknown, ...optionalParams: unknown[]) => void;
};

export function emitMeshDebugLogToSinks(targetWindow: Window, message: string, detail: unknown, options: EmitMeshDebugLogOptions): void {
  const meshDebug = (targetWindow as MeshDebugWindow).__meshDebug;
  meshDebug?.log?.(message, detail);
  if (!options.devMode) return;
  (options.consoleInfo ?? console.info)("[mesh-observe]", { message, detail });
}

