import type { KernelMinimalImpl } from "@mesh/kernel-minimal";
import type { Command, CommandOutcome } from "@mesh/shared";

export type WriterCommand = Omit<Command, "commandId" | "actorId" | "idempotencyKey"> & {
  commandId: string;
  actorId?: string;
  idempotencyKey?: string;
};

export class SimWriters {
  constructor(private readonly kernel: KernelMinimalImpl, private readonly writerCount: number) {}

  submitCommand(writerId: number, command: WriterCommand): Promise<CommandOutcome> {
    return this.kernel.execute(this.makeCommand(writerId, command));
  }

  retrySameIdempotency(writerId: number, command: WriterCommand): Promise<CommandOutcome> {
    return this.kernel.execute(this.makeCommand(writerId, command));
  }

  submitWithStaleBaseRevision(
    writerId: number,
    command: WriterCommand,
    staleBaseRevision: string
  ): Promise<CommandOutcome> {
    return this.kernel.execute({
      ...this.makeCommand(writerId, command),
      requireBaseRevision: staleBaseRevision
    });
  }

  private makeCommand(writerId: number, command: WriterCommand): Command {
    if (writerId < 0 || writerId >= this.writerCount) {
      throw new Error(`writerId out of range: ${writerId}`);
    }
    return {
      ...command,
      actorId: command.actorId ?? `writer-${writerId}`,
      idempotencyKey: command.idempotencyKey ?? `${command.commandId}-key`
    };
  }
}
