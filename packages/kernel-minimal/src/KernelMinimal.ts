import type { Command, CommandOutcome, FaultInjectionHooks } from "@mesh/shared";

export type Outcome = CommandOutcome;

/** spec-ref: Mesh_Execution_Compiled_v_1.md §11.5 */
export interface KernelMinimal {
  execute(command: Command, hooks?: FaultInjectionHooks): Promise<Outcome>;
}
