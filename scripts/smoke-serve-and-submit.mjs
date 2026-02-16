import { SyncHttpReferenceServer } from '../packages/sync-http/dist/index.js';

const graphSpaceId = 'smoke-space-v1';

const gateway = {
  submit: (_graphSpaceId, _principal, command, idempotencyKey) => ({
    ackTransport: { accepted: true, idempotencyKey: idempotencyKey ?? command?.idempotencyKey ?? 'missing' },
    final: Promise.resolve({
      status: 'ok',
      txId: 'smoke-tx-1',
      cursorVisibleAfter: 1,
      idempotencyKey: idempotencyKey ?? command?.idempotencyKey ?? 'missing'
    })
  }),
  syncPull: async () => ({ txBundlesVisible: [], cursorAfterVisible: 0 }),
  syncSubscribe: async function *syncSubscribe() {},
  eventsRead: async () => [],
  syncPoll: async (_space, _principal, cursor) => ({ meta: [], graph: [], cursorAfter: cursor })
};

const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });
const listen = await server.listen(0, '127.0.0.1');

try {
  const response = await fetch(`${listen.url}/v1/${graphSpaceId}/commands:submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mesh-principal': 'alice'
    },
    body: JSON.stringify({
      graphSpaceId,
      commandId: 'smoke-command-1',
      actorId: 'alice',
      idempotencyKey: 'smoke-idem-1',
      payload: { type: 'smoke.command' }
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.status !== 'ok') {
    throw new Error(`Smoke submit failed: ${JSON.stringify(payload)}`);
  }
  console.log('smoke:serve-and-submit ok', payload.txId);
} finally {
  await server.close();
}
