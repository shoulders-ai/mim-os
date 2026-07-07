# Security & Permission Model

What the gate is: a speed-bump on **AI/app automation** so a user can catch an
unintended or destructive action before it runs. Defense in depth: the renderer is
hardened against XSS (DOMPurify on all v-html), IPC is locked to `actor: 'user'`,
and the local server restricts CORS to known origins.

## Enforcement point

`tools.call(name, params, ctx)` runs `gate.check(tool, params, ctx)` **before**
`tool.execute` (`src/main/tools/registry.ts`). A denied check throws `PermissionDeniedError`
and the body never runs. The Electron app (`index.ts`) and the headless CLI
(`headless.ts`) each construct a gate; a registry built without one enforces
nothing.

## Actors (`ctx.actor`) — this is the trust boundary

- `kernel:call` IPC **hardcodes** actor to **`user`** (`index.ts`). The renderer
  cannot claim `ai`/`package`/`system` — only main-process internals set those.
- **`user` / `system`** → always allowed, never prompts.
- **`ai`** → the only actor the interactive gate ever prompts. AI tool calls
  originate in main from the AI runtime with `actor: 'ai'` (`src/main/ai/aiRuntime.ts`), not via
  renderer IPC.
- **`package`** → declared-permission check only (`packagePermissionViolation`);
  pass → allowed silently, fail → throw. Apps never get an interactive prompt.

App-mounted agents (`export const agents` in a backend) execute as actor `ai`
through the same gate. Agents are backend exports, so the workspace trust ack
already applies — no separate exemption.

Consequence: the gate defends against the agent's autonomous actions and app
automation. The renderer cannot escalate because IPC is hardcoded to `user`.

## Modes

Source: `.mim/settings.json` → `automationApprovalMode` (`readApprovalMode` in
`index.ts`); defaults to `normal` with no workspace/setting.

- **strict** → every `ai` action prompts (reads included).
- **normal** → prompts when the tool's effect is `mutate` or `external`.
- **developer** (UI label "Allow all") → bypassed before any check; prompts nothing.

**Path floor:** a `sensitive` or `outside-workspace` path always prompts under
strict + normal, regardless of effect — including when a session "always allow"
is active for the same tool. The floor is checked before session allows so it
can never be suppressed. Developer bypasses it (the bypass is checked before
the floor).

## Effect is the prompt key — not risk

`toolEffect(name)` = `EFFECT_OVERRIDES[name]` ?? `categoryEffect(policy.category)`
(`src/main/security/gate.ts`).

- `categoryEffect`: `read`/`search`/`ai` → **read**; `network` → **external**;
  everything else (`write`/`secrets`/`system`/`settings`/`ui`/`general`) **and any
  unmapped tool** → **mutate**.
- **`read` means "no prompt in Normal, still prompt in Strict."** So it doubles as
  the exemption tag for benign mutations. `EFFECT_OVERRIDES` uses it for internal
  writes (`workspace.orient`, `log.append`) and for reads/navigation mis-filed in a
  mutating bucket (`editor.open`, `workbench.open*`, `settings.get`, status pings).
- **Unknown tool → `mutate`** (prompts in Normal/Strict). To change a tool's
  behavior, edit `TOOL_POLICIES` (category) and/or `EFFECT_OVERRIDES`.
- `risk` (low/medium/high) no longer gates anything; it only sets the inline
  approval card's caution styling.

## Agent sessions (`agent.*`)

Agent sessions are interactive ptys carrying the user's full shell authority
(see [agent-sessions.md](agent-sessions.md)), so the gate treats the surface
specially:

- **`agent.launch` / `agent.stop` are user-only.** The `ai` actor is
  **hard-denied** before any approval flow or developer-mode bypass — the same
  pattern as `app.trust`. AI already has `terminal.run` for command execution;
  it cannot start or stop agent sessions.
- **The whole `agent.*` surface is denied to app actors**
  (`packagePermissionViolation` matches the `agent.` prefix): catalog,
  launch/kill, session records, and scrollback are all off-limits to apps.
- Effects for the `ai` actor where calls are allowed: `agent.list`,
  `agent.sessions.list`, and `agent.sessions.get` are `read` (no prompt in
  Normal, prompt in Strict). `agent.sessions.rename`/`archive` (category
  `ui`) and `agent.sessions.delete` (category `ui`, risk `medium`) are
  `mutate`, so they prompt in Normal and Strict. `agent.launch`/`agent.stop`
  are policy-listed (`general`/`medium`) but unreachable for `ai` because of
  the hard deny.

## Sensitive paths (`src/main/security/gate-paths.ts`)

Locations: `.ssh .gnupg .aws .config/gcloud .kube .docker .npmrc .pypirc /etc
/private/etc /var/run /Library/Keychains`. Exact segments: `credentials secrets
.netrc .bashrc .zshrc .profile .bash_profile .bash_history .zsh_history`.
Prefix segments: `.env` (matches `.env`, `.env.production`, `.env.local`, etc.
but not `envelope.md` or `environment.ts`). SSH key patterns:
`id_rsa`/`id_ed25519`/`id_ecdsa`/`id_dsa` and their `.pub` counterparts.
Classification → `workspace` | `sensitive` | `outside-workspace` | `invalid`.

## Redaction & audit (two separate redactors)

- **Approval request → renderer** carries `params` redacted by
  `redactPermissionParams` (`/content|key|token|password|secret/i`) **plus** a
  `preview` with **un-redacted** file content (`buildApprovalPreview`, from raw
  params). The un-redacted content is deliberate — it's the user's own file, shown
  so they can review the change. It never enters event summaries.
- **Persisted audit** is the unified trace stream (`.mim/traces/YYYY-MM-DD.jsonl`,
  `src/main/trace/trace.ts`), with event `summary` fields produced in
  `src/main/tools/registry.ts` by a **broader** redactor:
  `/(^|_)(body|code|content|key|password|secret|snippet|subject|text|token)($|_)/i`
  — so send payloads (subject/body/text) are redacted there even though the card
  shows them. The same known-safe file-mutation set as the approval preview
  (`fs.write`/`fs.edit`/`fs.create`) additionally stores its raw params as
  payload blobs under `.mim/traces/blobs/` — user-own-content, never keys or
  tokens; this is the edit-distance raw material for the learning loop
  (`plan-observability.md`).
- **Gate decision audit** is durable in both kernels: `index.ts` and
  `headless.ts` inject a `recordDecision` callback (`traceGateDecision`) that
  writes each gate decision (allowed/denied/requested/approved/bypassed) as a
  `gate.decision` trace event parented under the gated tool-call span. Params
  stay redacted. Logging is best-effort and never blocks.

## Code Execution Gate

Two registry tools provide command execution:

**`shell.run`** (AI key: `bash`) — full shell access with captured output. Gated
with `{ category: 'system', risk: 'high', targetParam: 'command' }`. The approval
card shows "run a shell command" plus the command string. Per-call approval with
session "always allow" checkbox.

**`code.run`** — allowlisted interpreter execution for the Render button and
headless CLI. Gated with `{ category: 'system', risk: 'high', targetParam: 'argv' }`.

The `shell.run` tool-policy row (`src/main/tools/toolPolicy.ts`) governs the
`bash` AI tool key with risk `sensitive` and `defaultEnabled: true`. Users
disable it in Settings > Tools to remove the `bash` tool from the AI tool set
entirely. Disabling it does NOT affect `code.run` (the Render button path).

The `code.run` row remains for the interpreter allowlist and Settings > Tools
interpreter toggles. Interpreter resolution enforces decision D6: only absolute
paths detected by the login shell are spawnable. The `codeInterpreters` setting
(default: `['rscript', 'r', 'quarto']`) further restricts which detected
interpreters `code.run` accepts.

## Session "Always allow"

The checkbox sets `sessionToolAllows` key `${sessionId}:${tool.name}` — a full
allow of that exact tool for that session (no per-action carve-outs), subject
to the path floor (sensitive/outside-workspace paths still prompt even with
session allow). Cleared by `cancelSession(sessionId)`, which also resolves all
pending approval promises for that session as denied. The renderer calls
`cancelGateSession` via the `gate:cancel-session` IPC in `handleStop`, and
clears the approval store queue so inline cards disappear immediately.

## Hardening layers

- **XSS mitigation**: all `v-html` sites (chat, editor preview, archive cards)
  sanitize through DOMPurify (`src/renderer/services/sanitize.ts`) with a strict
  allowlist of tags and attributes (inert structural tags like `details`/`figure`/
  `dl` are allowed; `data-*`, event handlers, and script-bearing tags are not).
- **CSP**: `src/renderer/index.html` carries a restrictive Content-Security-Policy
  meta (no inline script, connect/frame limited to the local kernel server and dev
  server) as defense in depth behind DOMPurify.
- **Symlink escape prevention**: `resolveWorkspacePath` in `src/main/tools/fs.ts`
  checks that symlinks — including dangling ones, whose targets a write would
  create — resolve inside the workspace (`.mim/resources/` mounts exempt — they
  have their own write-policy gate). Errors during the check fail closed except
  ENOENT.
- **CORS**: the local Express server restricts `Access-Control-Allow-Origin` to
  the app's own `127.0.0.1:<port>`, `localhost:<port>`, `null` (file://), and
  the dev server origin. Foreign web pages get no CORS headers.
- **WebSocket identification**: every WS method including `packages.list` and
  `__meta.tools` requires `identify` first. App iframes identify with
  launch tokens. MCP clients identify with desktop-minted MCP bearer tokens.
  MCP connections are bound as `actor: "user"` — CLI agents have their own
  permission gates, and the MCP allowlist is the security boundary. Tools are
  server-allowlisted before tool dispatch; `packages.list` stays app-only. The discovery MCP token is
  valid for the desktop process lifetime; per-agent MCP tokens are revoked when
  their live agent session ends.
- **IPC actor**: renderer IPC is hardcoded `actor: 'user'` — the renderer cannot
  claim AI or app identity.
- **API key hygiene**: `~/.mim/keys.env` is written with `mode: 0o600` and
  re-`chmod`ed on every write (the mode option alone does not fix pre-existing
  files); Gemini API key uses the `x-goog-api-key` header (not the URL query
  string).
- **App HTTP redirects**: `redirect: 'manual'` prevents automatic redirect
  following that could bypass the host allowlist.

## Known limits

- `developer` mode and `user`/`system`/`package` actors all bypass interactive prompts.
- No durable app permission manifest or policy engine (README tech debt).
- `BrowserWindow` uses `sandbox: false`; enabling sandbox is a future hardening step.
- App iframes use `allow-same-origin` (required for SDK WebSocket); full
  origin isolation is an architectural follow-up. A per-boot shell token
  (`x-mim-shell-token`) guards `/api/ai/*` routes so iframes cannot drive the
  AI runtime directly — only the trusted renderer shell (via preload bridge)
  obtains the token.
- Local images must go through `fs.readImageDataUrl`, not `file://`.

## Tests

- `src/main/security/gate.test.ts` — effect classification, each mode, the path floor,
  preview shape, the redaction invariant (preview carries content while the audit
  event stays redacted), the `log.append` Normal-exemption-but-Strict-prompt,
  sensitive-path floor vs session always-allow (Fix 1), durable audit events
  (Fix 2), cancelSession resolves pending approvals as denied (Fix 4), agent
  session tool policies and the user-only `agent.launch`/`agent.stop` denial.
- `src/main/tools/registry.test.ts` — registry runs the gate before execute, suspends until
  it resolves, blocks execution on denial, and redacts event summaries.
- `src/main/tools/fs.test.ts` — symlink escape prevention: rejects symlinks
  pointing outside workspace for read/write/delete (including dangling links),
  rejects symlinked directories, allows workspace-internal symlinks, exempts
  `.mim/resources/` managed mounts.
- `src/renderer/services/sanitize.test.ts` — DOMPurify wrapper strips scripts,
  event handlers, iframes, forms, `javascript:` hrefs, and `data-*` attributes.
- `src/main/server/server.test.ts` — CORS origin restriction: allows same-origin
  and `null`, denies foreign origins; `packages.list` refused before WS
  identification; MCP identify, metadata, server-side allowlist, app-only
  app listing, and AI actor/session routing.
- `src/main/packages/packageHttp.test.ts` — verifies `redirect: manual` is passed
  to the HTTP client.
- UI: `InlineApproval.smoke.test.ts`, `approvalLogic.test.ts`,
  `approvalSummary.test.ts`, `services/approvalDiff.test.ts`,
  `stores/approvals.test.ts`, `DiffReviewBar.smoke.test.ts` (approval branch).
