import type { LocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES, type Command, type CommandOutcome, type IdempotencyCtx } from "@mesh/shared";
import { canonicalStringify, sha256Hex } from "./canonicalHash.js";
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
      payloadHash: sha256Hex(canonicalStringify({ payload: command.payload, requireBaseRevision: command.requireBaseRevision }))
    };

    if (command.requireBaseRevision) {
      const resolvedBaseRevision = await this.eventStore.resolveRevision(command.graphSpaceId, command.requireBaseRevision);
      if (!resolvedBaseRevision) {
        return {
          status: "rejected",
          commandId: command.commandId,
          category: "VALIDATION",
          reasonCode: REASON_CODES.INVALID_BASE_REVISION
        };
      }
    }

    return this.eventStore.appendTx(
      command.graphSpaceId,
      {
        txId: command.commandId,
        metaEvents: [],
        graphEvents: [command.payload]
      },
      idempotencyCtx
    );
  }
}
