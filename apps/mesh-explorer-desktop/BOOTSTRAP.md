# Desktop bootstrap note

Root cause: in this repository lock graph, `electron@31.7.7` resolves `@electron/get@2.0.3`
without a complete transitive snapshot (notably missing `semver`), so `electron/install.js`
fails during postinstall with `Cannot find module 'semver'`.

To keep workspace bootstrap stable (including environments where fetching the missing transitive
branch is blocked), root `pnpm.neverBuiltDependencies` now skips the `electron` postinstall.
This confines the workaround to desktop bootstrap behavior and avoids any core/conformance
dependency or runtime coupling change.
