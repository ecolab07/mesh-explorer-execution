import type { LocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES, type Command, type CommandOutcome, type IdempotencyCtx } from "@mesh/shared";
import type { KernelMinimal } from "./KernelMinimal.js";

export class KernelMinimalImpl implements KernelMinimal {
  constructor(private readonly eventStore: LocalEventStore) {}

  async execute(command: Command): Promise<CommandOutcome> {
    if (!command.graphSpaceId || !command.commandId || !command.actorId || !command.idempotencyKey || !command.payload) {
      return {
        status: "rejected",
        commandId: command.commandId,
        category: "VALIDATION",
        reasonCode: REASON_CODES.MALFORMED_COMMAND
      };
    }

    const idempotencyCtx: IdempotencyCtx = {
      actorId: command.actorId,
      idempotencyKey: command.idempotencyKey,
      // TODO(spec-ref: §14.2): replace placeholder with CanonicalHasher-based semantic hash.
      payloadHash: JSON.stringify({ payload: command.payload, requireBaseRevision: command.requireBaseRevision })
    };

    return this.eventStore.appendTx(
      command.graphSpaceId,
      {
        txId: command.commandId,
        // TODO(spec-ref: §18.2.1): route CMD.NOOP metaEvents/graphEvents payload explicitly.
        metaEvents: [],
        graphEvents: []
      },
      idempotencyCtx
    );
  }
}
