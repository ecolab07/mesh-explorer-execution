import type { LocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES, type Command, type CommandOutcome, type IdempotencyCtx } from "@mesh/shared";
import { canonicalStringify, sha256Hex } from "./canonicalHash.js";
import type { KernelMinimal } from "./KernelMinimal.js";

type AuthorizationDecision = "allow" | "deny" | "mask";

interface AuthorizationResult {
  decision: AuthorizationDecision;
  reasonCode?: string;
  masked?: boolean;
}

interface Authorizer {
  authorize(command: Command): AuthorizationResult | Promise<AuthorizationResult>;
}

const PERMISSIVE_AUTHORIZER: Authorizer = {
  authorize(): AuthorizationResult {
    return { decision: "allow" };
  }
};

const PERMISSION_DENIED_REASON_CODE = "CMD.PERMISSION.DENIED";

type EventStoreWithInternalAuthorizer = LocalEventStore & {
  __meshInternalAuthorizer?: Authorizer;
};

export class KernelMinimalImpl implements KernelMinimal {
  private readonly authorizer: Authorizer;

  constructor(private readonly eventStore: LocalEventStore) {
    this.authorizer = (this.eventStore as EventStoreWithInternalAuthorizer).__meshInternalAuthorizer ?? PERMISSIVE_AUTHORIZER;
  }

  async execute(command: Command): Promise<CommandOutcome> {
    if (!command.graphSpaceId || !command.commandId || !command.actorId || !command.idempotencyKey || !command.payload) {
      return {
        status: "rejected",
        commandId: command.commandId,
        category: "VALIDATION",
        reasonCode: REASON_CODES.MALFORMED_COMMAND
      };
    }

    let requiredBaseCursor: { metaSeq: number; graphSeq: number } | undefined;
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
      requiredBaseCursor = resolvedBaseRevision;
    }

    const authorization = await this.authorizer.authorize(command);
    if (authorization.decision !== "allow") {
      return this.toAuthorizationError(command, authorization);
    }

    const idempotencyCtx: IdempotencyCtx = {
      actorId: command.actorId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: sha256Hex(canonicalStringify({ payload: command.payload, requireBaseRevision: command.requireBaseRevision })),
      requiredBaseCursor
    };

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

  private toAuthorizationError(command: Command, authorization: AuthorizationResult): CommandOutcome {
    if (authorization.decision === "mask") {
      return {
        status: "rejected",
        commandId: command.commandId,
        category: "NOT_FOUND",
        reasonCode: REASON_CODES.NOT_FOUND_GENERIC
      };
    }

    return {
      status: "rejected",
      commandId: command.commandId,
      category: "PERMISSION",
      reasonCode: PERMISSION_DENIED_REASON_CODE
    };
  }
}
