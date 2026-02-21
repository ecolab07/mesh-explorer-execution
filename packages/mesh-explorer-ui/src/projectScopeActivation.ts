export type ActivateProjectScopeDeps = {
  setActiveProject: (projectId: string) => void;
  updateRouteSelection?: (projectId: string) => void;
  bootstrapScopeSync: (projectId: string) => void | Promise<void>;
  hydrateScopePolicy: (projectId: string) => void | Promise<void>;
};

export async function activateProjectScope(projectId: string, deps: ActivateProjectScopeDeps): Promise<void> {
  deps.setActiveProject(projectId);
  deps.updateRouteSelection?.(projectId);
  await deps.hydrateScopePolicy(projectId);
  await deps.bootstrapScopeSync(projectId);
}
