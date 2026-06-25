# Known Issues

Logged items that require a separate effort. Fix small things inline; log larger ones here.

## Open

- **Electron is behind on security patches (`^35.0.0`).** A major-version upgrade is needed — it rebuilds all native modules (better-sqlite3, node-pty, keytar) and may touch BrowserWindow/security APIs. Do as a focused upgrade with a full app smoke test.
- **`keytar.node` arch drift after `electron-rebuild`.** If test collection failures appear across files importing keytar, rebuild keytar for the host arch or mock it at the test boundary.
- **White theme: hover backgrounds are near-invisible.** The `white` theme `--color-chrome-mid` is too close to `#ffffff` for the hover token to read. Consider a dedicated `--color-hover` token.
- **No single-instance or workspace lock.** Two app instances can open the same workspace and corrupt `.mim/` state. Needs a lockfile or IPC-based single-instance guard.
- **Workspace deletion or unmount while open is never detected.** The app continues operating against a missing path. No recovery or re-prompt path exists.
- **Hung job blocks its non-parallel slot until restart.** A package job that never resolves holds the concurrency slot forever. No timeout or watchdog mechanism exists.
- **Linux: keytar throws when no OS keyring is running.** On minimal WMs or headless Linux without GNOME Keyring/KWallet, secret-backed integrations fail loudly; needs an encrypted local fallback.
- **Platform shell hardcodes slides-specific result fields.** `PackageRunView` and related components contain slides-specific assumptions that should be generic package capabilities.
- **`web.read`: Readability crash fallback has no test.** The try/catch around Readability.parse() (added after `shoulde.rs` crashed it) has no test exercising the catch path.
- **`src/main/tools/web.ts` has no co-located test.** Convention says `foo.ts` gets `foo.test.ts`. The kernel tool registration is thin wiring but should have a smoke test.
- **Packages can call `web.read`/`web.search` without declaring permissions.** The `packagePermissionViolation` function has no explicit check for `web.*` tools. They fall through as allowed. Decide if packages should need to declare `web` or `network` permission.
- **Full test suite has unrelated web-reading/history failures.** Current failures include the web-reading `partial` vs setup-attention contract, rendered-capture `signals` expectations, system prompt web-read wording, and two history pruning timeout tests. Needs a focused pass on the web-reading branch and history test performance.
