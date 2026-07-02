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
- **History folding tests can time out only under the full parallel suite.** `src/main/history/history.test.ts` passes alone, but the two 1000-version folding/prune tests can exceed the default 5s timeout under full-suite load. Optimize the test setup or give those cases an explicit timeout.
- **Apps settings tests are out of sync with the current Apps panel copy.** `AppsSettingsPanel.sections.test.ts` still expects `In workspace, not in my sidebar`, and `SettingsDialog.smoke.test.ts` still expects `My Sidebar`, while the panel now renders `Workspace app` and `Apps`/`Available`.
- **Tool-policy tests reference a missing implementation.** The full suite currently fails because `src/main/tools/toolPolicy.test.ts` imports `@main/tools/toolPolicy.js`, but no matching implementation exists. Finish or remove the in-progress tool-policy module and bring the related AI/runtime/server policy tests back into sync.
- **`mim list-tools` omits dynamic app tools.** The command creates a headless kernel but does not open a workspace before listing tools, so enabled named package tools are absent from the output even though `mim tool <named.app.tool>` works once a workspace is opened. Decide whether `list-tools --workspace <path>` should open the workspace or document that it is a static/core-only listing.
