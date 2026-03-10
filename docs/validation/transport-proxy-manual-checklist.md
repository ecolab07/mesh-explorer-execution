# Transport Proxy Manual Validation Checklist

1. Start canonical backend on `127.0.0.1:8090`.
2. Start proxy on `127.0.0.1:8091` (`pnpm dev:transport-proxy`).
3. Open Tab A against `:8090`, Tab B against `:8091`.
4. Confirm `curl http://127.0.0.1:8091/__test/transport/state` reports `subscribeMode: "pass"`.

## Pass mode
1. Keep mode as `pass`.
2. Trigger mutation in Tab A.
3. Verify Tab B gets normal subscribe updates.
4. Check proxy logs for intercepted subscribe pass-through.

## Fail mode
1. Keep an active subscribe stream open in Tab B, then `POST /__test/transport/mode` with `{"subscribeMode":"fail"}`.
2. Verify the active stream is terminated immediately (no manual `close` detour).
3. Reconnect subscribe from Tab B and verify deterministic non-2xx response.
4. Verify non-subscribe routes still work via proxy.

## Hang mode
1. Keep an active subscribe stream open in Tab B, then set mode to `hang`.
2. Verify the active stream is terminated immediately (no manual `close` detour).
3. Trigger subscribe from Tab B and verify request stays pending with no events delivered.
4. Trigger mutation in Tab A; verify no pushed update in Tab B.
5. Verify non-subscribe routes still work.

## Close mode
1. Set mode to `close`.
2. Trigger subscribe from Tab B.
3. Verify stream starts then terminates deterministically.
4. Trigger mutation in Tab A and verify no continued push on closed stream.

## Toggle without restart + edge cases
1. Change `hang -> pass` without restarting proxy; confirm state endpoint changes immediately.
2. Reconnect subscribe and verify normal behavior in `pass` mode.
3. Set same mode twice and verify idempotent success.
4. Submit unsupported mode and verify stable `INVALID_SUBSCRIBE_MODE` error.
5. Confirm Tab A direct backend behavior is unaffected by proxy modes.
