# @mesh/cli

Minimal CLI for local Mesh runtime operations.

## Usage

```bash
mesh status
mesh read --rootDir ./data --graphSpaceId demo --principalId alice
mesh write --rootDir ./data --graphSpaceId demo --principalId alice \
  --actorId alice --commandId cmd-1 --idempotencyKey idem-1 \
  --payloadJson '{"type":"set","value":1}'
```

All non-help output is JSON on stdout.

## Commands

- `mesh write`: starts runtime, submits one command, prints write outcome JSON, and stops.
- `mesh read`: starts runtime, reads default view `{ head, view }`, and stops.
- `mesh status`: prints basic status and optional file existence checks.

Optional runtime flags for read/write:

- `--snapshotMinTx <n>`
- `--snapshotIntervalMs <n>`
- `--replayMaxTx <n>`
- `--replayMaxMs <n>`
