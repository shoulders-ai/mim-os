# Proposal: Trust Model v1 — one Google connection, shared by core and apps

Status: proposed (2026-07-16). Companion change in mim-apps `packages/mail/`.

## 1. Problem

Auth and permission machinery absorbs a disproportionate share of development
attention. Every app that touches a personal integration re-derives an auth
design; the Mail app alone carries ~1,400 lines (backend OAuth module + tests +
a 5-step Google Cloud Console onboarding) that exist only because apps are
barred from the Google connection the user already made in core
(`gate.ts:1145` — "cannot access personal Google integrations in runtime v1").

The deployment reality this machinery was built for does not exist yet:

- One workspace, 2–3 users who trust each other.
- Every app is first-party (authored in this org, installed from our registry).
- App backends run **in the Electron main process with full Node access** —
  there is no sandbox (`docs/app-system-api.md` "Known limits",
  `packageRuntime.ts:231` is a plain `import()`). The per-app keychain
  namespace, the http host allowlist, and the gate's prefix blocks are policy
  for honest code, not containment for malicious code.

So the current state is the worst trade: soft security, hard UX. The per-app
OAuth ceremony stops no attacker a shared connection wouldn't also stop, while
costing every Google-touching app its own GCP project setup, client-type
pitfalls (web vs. installed), token storage, refresh logic, and onboarding.

## 2. The ruling: Trust Model v1

Until the first non-first-party app exists, the platform operates under these
assumptions, and agents must not build beyond them:

1. **Apps are trusted code.** They run with the user's authority. Isolation
   between apps, and between apps and core, is legibility (attribution,
   declared permissions) — not defense.
2. **One connection per external service, owned by core.** Apps consume it via
   a runtime capability. No app implements its own OAuth flow.
3. **The human boundaries that are product features stay.** The Mail send gate
   (UI-only tools + the audience dispatch refusal in `packageRuntime.ts`), the
   AI approval prompts, and the local MCP allowlist are unchanged.
4. **No new permission machinery without an explicit user decision.** An agent
   that believes a task needs new auth/permission surface logs it in
   `docs/issues.md` and stops, rather than building it.

Revisit trigger: the registry accepts a package not authored by this org. At
that point the deferred work in §10 becomes real.

## 3. What changes

### 3.1 Core: add the `gmail.modify` capability

`src/main/integrations/google/client.ts` already has a capability→scope model
(`GOOGLE_SCOPE` at :40, `GOOGLE_CAPABILITY_SCOPES` at :53,
`DEFAULT_CAPABILITIES` at :65). Add:

- `gmailModify: 'https://www.googleapis.com/auth/gmail.modify'` to
  `GOOGLE_SCOPE`, a `'gmail.modify'` capability mapping to it.
- Default capabilities become `profile, gmail.modify, calendar.read,
  calendar.write, drive.read, sheets.read`. `gmail.modify` is a strict
  superset of `gmail.readonly` and is accepted by the send endpoint, so
  `gmail.read`/`gmail.send` drop out of the default list (the capabilities
  remain defined for existing token bundles).

Verification burden is unchanged: `gmail.readonly` is already a restricted
scope, and BYO clients in Internal/Testing consent mode need no verification.
Existing connections keep working read/send until the user reconnects once
(`google.connect` uses `prompt: 'consent'`, so one click re-issues the bundle
with the new scope).

### 3.2 Core: `ctx.google` runtime capability for app backends

New field on `PackageRuntimeContext` (`packageRuntime.ts:64–155`, constructed
in `createRuntimeContext` at :572–728, wired like `ctx.secrets`):

```ts
ctx.google: {
  status(): Promise<{ connected: boolean; email?: string; scopes: string[] }>
  accessToken(): Promise<string>   // refreshes via GoogleIntegration; throws if not connected
}
```

- Backed by the existing `GoogleIntegration` instance (`client.ts:93–627` —
  the sole reader/writer of the `google-client:{account}` / `google:{account}`
  keychain slots, with refresh already implemented in `accessToken()` at
  :553). The instance is passed into `PackageRuntimeOptions` alongside
  `secrets`.
- Requires a one-line manifest declaration: `permissions.google: true`
  (`packageManifest.ts`). Undeclared → `ctx.google` throws, same pattern as
  `unavailableSecretsApi()`. The declaration is install-time legibility ("Mail
  uses your Google connection"), not a ceremony.
- Apps never see the refresh token or the client secret; they get short-lived
  access tokens that Google expires in ~1 h regardless.

### 3.3 Core: remove the gate's Google prefix block

Delete `gate.ts:1145–1147` (the `google./gmail./calendar./drive./docs./sheets.`
prefix denial for `package` actors) and update the corresponding test
(`gate.test.ts:578–584`) to assert the call is allowed for an app with
`permissions.google`. Apps can then also call the core tools (`calendar.events`,
`drive.search`, …) instead of reimplementing them over REST.

Note: `requireGoogleAiAccess` (`google/tools.ts:652–676`) checks tool-policy
enablement only for `actor === 'ai'` and returns early otherwise; after this
change, package calls bypass the Settings > Tools toggles. That is consistent
with trust model v1 (the toggles govern what the *AI* may reach, not what
trusted app code may do) and is recorded as a §10 deferred item.

The sibling blocks (`slack.*` at :1137, `web.*` at :1141) follow the same
one-line removal **when an app first needs them** — that removal requires no
new discussion, this ruling covers it.

### 3.4 Mail: delete self-contained OAuth

The seam is a single injection point: every Gmail API call goes through
`createGmailClient({ oauth })` and `oauth.accessToken()`
(`packages/mail/backend/gmail.mjs:6,15`); `sync.mjs` never touches oauth.

- Replace `oauthFor(ctx)` (`index.mjs:153`) with an adapter:
  `{ accessToken: () => ctx.google.accessToken() }`. `gmail.mjs` drops its
  401-retry call to `refreshAccessToken` (the runtime refreshes internally).
- Delete `backend/oauth.mjs` (279 lines), `backend/oauth.test.mjs` (505),
  `ui/js/onboarding.js` (299) + its test (68), the `.ob-*` CSS, the
  `node:http` import, `secretsSnapshot()`, and the `connect_start` /
  `connect_disconnect` tools. `connect_status` becomes a thin report over
  `ctx.google.status()` (including a "reconnect to grant label access" hint
  when the token predates `gmail.modify`).
- Onboarding collapses to one screen: if `ctx.google.status().connected`,
  proceed straight to backfill-window selection; otherwise a single "Connect
  Google in Mim Settings" action.
- Manifest: `permissions.secrets` (both slots) and `oauth2.googleapis.com`
  are removed; `google: true` and `gmail.googleapis.com` remain.

Net effect in mail: ~1,400 lines deleted, ~150 added. No schema or data
migration; the local mirror (`~/.mim/private/mail/mail.sqlite`) is untouched.
Stale `package:mail:google_oauth_*` keychain entries are deleted on first run.

### 3.5 Docs: encode the ruling where agents read it

- `docs/security.md`: add a "Trust model" section (the §2 text), update the
  package-actor rules.
- `AGENTS.md`: one line — "Trust model v1 applies: do not add auth or
  permission machinery; see docs/security.md."
- Update the block-list mentions in `docs/integrations.md` ("Permission
  Rules"), `docs/app-system-api.md` (permissions table + new `ctx.google`
  section), `manual/privacy-security.md`, `manual/develop/security.md`,
  `docs/_MAP.md`.
- `docs/issues.md`: close the "package.tools.execute approval prompt masks the
  target tool's policy" issue as mooted for v1 or re-scope it.

## 4. What deliberately stays

- **The Mail send gate.** `mail_approve`/`mail_send` remain UI-only
  (`audience: ['ui']`) and the runtime's dispatch refusal for AI callers
  stands. This is a product commitment (human control over sending), not
  enterprise posture. Core `gmail.send` also keeps its normal-mode approval
  prompt for AI callers.
- OS keychain storage, the `ctx.http` host allowlist (declared intent +
  audit), per-app trace attribution, the `app.trust` acknowledgement, and the
  `package.secrets.*` mechanism for genuinely app-specific secrets (API keys).

## 5. Blast radius

mim-os:

| File | Change |
| :-- | :-- |
| `src/main/integrations/google/client.ts` | `gmail.modify` scope + capability; default capability list |
| `src/main/integrations/google/client.test.ts` | scope/capability cases |
| `src/main/packages/packageRuntime.ts` (+ test) | `ctx.google`, `PackageRuntimeOptions.google` |
| `src/main/packages/packageManifest.ts` (+ test) | `permissions.google?: boolean` |
| `src/main/security/gate.ts` (+ test) | delete the Google prefix block (3 lines) |
| `src/main/index.ts`, `src/main/headless.ts` | pass `GoogleIntegration` into the package runtime |
| docs listed in §3.5 | trust-model section + block-list updates |

mim-apps (`packages/mail/`):

| File | Change |
| :-- | :-- |
| `backend/oauth.mjs`, `backend/oauth.test.mjs` | delete |
| `backend/index.mjs` (+ test) | `ctx.google` adapter; drop connect flow tools/state; `connect_status` rewrite |
| `backend/gmail.mjs` (+ test) | drop 401 `refreshAccessToken` branch |
| `package.json` | permissions swap |
| `ui/js/onboarding.js` (+ test), `.ob-*` CSS | delete; one-screen replacement |
| `ui/js/{data,render,inbox,state,shortcuts}.js` | remove BYO-client routing (~30 lines) |
| `README.md`, `docs/plan.md`, `docs/CONTRACTS.md` | Setup section, §2/§3/§5/§9 (plan), §0/§1/§3.2/§8 (contracts) |

Not touched: sync engine, store/FTS, proposals/voices/flywheel, MIME, all
`mail.*` chat tools, serve, Slack, the renderer approval system.

## 6. Additional risk, honestly

1. **Any enabled app with `google: true` can read mail and send/write on
   Google with the user's authority, silently** (package actor never prompts).
   Previously hard-denied. Marginal real-world change is small: with no
   backend sandbox, malicious code already had the keychain and the network;
   the block only constrained honest code. The residual exposure is
   honest-but-buggy app code touching Google — mitigated by the manifest
   declaration, per-package trace attribution, and app trust ack.
2. **The shared token gets stronger.** `gmail.modify` allows label/archive/
   trash, not just read+send. It lives in the OS keychain, same as any desktop
   mail client's credential.
3. **Coarser revocation and audit at Google.** One client, one grant: revoking
   Mim revokes core and every app at once, and Google-side logs can't
   distinguish app from core. Mim-side traces can (per-tool, per-package), and
   disabling an app cuts its access instantly at the Mim level.
4. **Prompt-injection surface: unchanged.** App-mounted agents run as actor
   `ai` and keep approval prompts; core `gmail.send` existed before this
   proposal; Mail's send path stays human-gated.
5. **Network surface: unchanged** (§4, serve boundary).

## 7. What we gain

- **Velocity.** The per-app auth discussion is closed by ruling. Mail sheds
  ~1,400 lines; every future Google-touching app (calendar, Drive, CRM
  campaigns) starts connected instead of starting with an OAuth project.
- **Fewer failure modes.** The web-vs-desktop client-type trap, Testing-mode
  7-day token expiry per app, paste-JSON validation, and per-app keychain
  prompts all collapse into one connection managed in one place.
- **Better legibility than today.** One Google grant to reason about; every
  app call attributed in traces; app Google usage visible in its manifest.

## 8. UX impact

- **Connect once.** Settings > Integrations is the only place Google auth
  happens. Existing users reconnect once to pick up `gmail.modify`.
- **Mail onboarding: 5 steps → 0–1.** Connected: straight to choosing a
  backfill window. Not connected: one button to the settings connect flow.
  The ~5-minute Google Cloud Console walkthrough disappears from the README
  and the UI.
- **No new prompts.** Approval behavior for AI is unchanged; app calls remain
  silent as they are today for every other permitted tool.

## 9. Migration & rollback

Phase 1 (mim-os): scope + `ctx.google` + gate line + docs. Independently
shippable; nothing depends on Mail.
Phase 2 (mim-apps): Mail rewire + deletions; bump minor version.
Rollback is two revert commits; Mail's seam (`createGmailClient({ oauth })`)
accepts either token source, so the repos don't have to move in lockstep.

## 10. Deferred until the revisit trigger (§2)

- Broker model: per-app minted tokens scoped to declared capabilities,
  per-app consent UI, per-app Google-side revocation.
- Process/worker isolation for app backends (the actual sandbox).
- Tool-policy enforcement for `package` actors (`requireGoogleAiAccess`
  parity).
- Re-tightening `slack.*` / `web.*` if they were opened under this ruling.

## 11. Alternatives considered

- **Status quo.** Costs §1; protects against nothing the no-sandbox reality
  doesn't already concede.
- **Broker now.** Builds more auth machinery to solve a problem ("too much
  auth machinery") — deferred to §10 with a concrete trigger instead.
- **Apps may only call core Google tools (no raw token).** Insufficient for
  Mail (`history.list` incremental sync, batch message fetch, RFC 2822 send
  with threading are not core tools) and would push core to grow a
  Gmail-shaped tool surface instead.
