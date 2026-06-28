# Integrations

Mim integrations are main-process tools backed by small API clients and the OS keychain.

## Secrets

Secrets use `src/main/integrations/secrets.ts`.

- `createKeytarSecretStore()` stores values in the OS keychain via `keytar`.
- `createMemorySecretStore()` is only for tests.
- Keychain service name: `Mim`.
- Slack token account: `slack:{account}`.
- Google OAuth client account: `google-client:{account}`.
- Google token bundle account: `google:{account}`.
- Package secret account: `package:{packageId}:{name}` (see `src/main/packages/packageSecrets.ts` and [package-system-api.md](package-system-api.md)).

Never store Slack or Google tokens in `mim.yaml`, `.mim/settings.json`, `~/.mim/config.yaml`, or docs.

## Account Defaults

Integration tools resolve account labels in this order:

1. explicit `account` parameter
2. workspace `mim.yaml` key, `slack` or `google`
3. user-global `~/.mim/config.yaml` key, `defaults.slack` or `defaults.google`
4. `default`

Example workspace config:

```yaml
name: Acme Research
slack: acme
google: user@acme.example
```

Example user-global config:

```yaml
defaults:
  slack: acme
  google: user@acme.example
```

## Slack

Source:

- Client: `src/main/integrations/slack/client.ts`
- Tools: `src/main/integrations/slack/tools.ts`
- AI tools: `src/main/integrations/slack/aiTools.ts`
- Policy: `src/main/integrations/slack/policy.ts`
- Tests: `src/main/integrations/slack/client.test.ts`, `src/main/integrations/slack/tools.test.ts`, `src/main/integrations/slack/aiTools.test.ts`, `src/main/integrations/slack/policy.test.ts`
- Settings UI: `src/renderer/components/settings/ConnectionsSettingsPanel.vue`

Tools:

- `slack.setToken`, `slack.deleteToken`, `slack.status`
- `slack.connect` (accepts `file` for file-based token ingestion), `slack.disconnect`
- `slack.channels`, `slack.users`, `slack.dms`
- `slack.history`, `slack.search`, `slack.replies`
- `slack.send`

### Connector Policy

Slack AI access is governed by a 4-boolean connector policy:

- `aiEnabled` — expose Slack tools to AI chat (default: false)
- `sendEnabled` — expose `slack_send` to AI chat (default: false)
- `privateChannels` — allow AI to read private channels (default: false)
- `directMessages` — allow AI to read DMs (default: false)

Policy resolves per-field: workspace `.mim/settings.json` → user-global `~/.mim/config.yaml` → defaults. Both locations use the `connectors.slack` key.

Settings > Connections provides toggles for all four policy flags.

### AI Tool Exposure

Chat tools are conditionally included based on policy and connection state:

- `slack_search`, `slack_history`, `slack_channels`, `slack_replies` — visible when `aiEnabled` is true
- `slack_send` — visible when `aiEnabled` AND `sendEnabled` are true

When `privateChannels` is false, `slack.channels` excludes `private_channel` from the types parameter for AI calls. When `directMessages` is false, `slack.dms` is blocked for AI.

Backend policy enforcement runs in the tool execution layer: even direct kernel/CLI/MCP calls respect the policy for the `ai` actor.

### MCP Exposure

`slack.status`, `slack.connect`, and `slack.disconnect` are always present in the MCP catalog so CLI agents can check status and manage the connection lifecycle. Data tools (`slack.channels`, `slack.users`, `slack.dms`, `slack.history`, `slack.replies`, `slack.search`, `slack.send`) appear conditionally when a token is configured. MCP calls use the `user` actor, so the AI connector policy toggles do not apply — the MCP allowlist is the security boundary, and CLI agents have their own permission gates.

### Rate Limits

The Slack client retries once on HTTP 429 when `Retry-After` is 5 seconds or less. Longer rate limits throw with the retry-after duration.

### Trace Capture

Slack content tools (`slack.history`, `slack.search`, `slack.replies`) set `captureResult: false` — message bodies are not persisted in trace payload blobs. Audit metadata (tool name, account, channel, result count) is still recorded.

## Google

Source:

- Client: `src/main/integrations/google/client.ts`
- Tools: `src/main/integrations/google/tools.ts`
- AI tools: `src/main/integrations/google/aiTools.ts`
- Policy: `src/main/integrations/google/policy.ts`
- Tests: `src/main/integrations/google/client.test.ts`, `src/main/integrations/google/tools.test.ts`, `src/main/integrations/google/aiTools.test.ts`, `src/main/integrations/google/policy.test.ts`
- Settings UI: `src/renderer/components/settings/ConnectionsSettingsPanel.vue`

OAuth tools:

- `google.setOAuthClient`
- `google.setTokenBundle`
- `google.connect`, `google.disconnect`
- `google.status`
- `google.authUrl`
- `google.exchangeCode`

`google.connect` is the primary setup path. With `{ oauth: true }`,
it starts a localhost callback listener, opens the Google consent URL in the
default browser, validates the OAuth `state`, exchanges the returned code, and
stores the token bundle plus userinfo profile metadata in the OS keychain. The
callback listener binds to `127.0.0.1` on a random local port and shuts down
after success, failure, or timeout.

`google.setOAuthClient` stores a Google desktop OAuth client in the keychain.
Accepts a `file` parameter pointing to a Google Cloud Console JSON download
(`installed` or `web` format), or inline `client_id`/`client_secret`. Builds
can also provide `MIM_GOOGLE_OAUTH_CLIENT_ID` / `MIM_GOOGLE_OAUTH_CLIENT_SECRET`
(or the `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` aliases).

`google.setTokenBundle` and `google.connect` with `access_token` (or `file`
pointing to a token bundle JSON) are advanced/manual setup paths.

### AI Agent Connection Management

The AI agent can manage the full Google and Slack connection lifecycle through
always-present tools in the chat profile:

- `connections_status()` — check connection state for all integrations
- `google_set_oauth_client(file?)` — store OAuth client from file (credentials never enter chat)
- `google_connect(oauth?, file?)` — browser sign-in or file-based token bundle
- `google_disconnect()` — remove tokens
- `slack_connect(file?)` — store and verify a Slack token from file
- `slack_disconnect()` — remove tokens
- `connections_configure(integration, ...)` — set policy flags (aiEnabled, etc.)

File-based credential ingestion reads secrets server-side in the main process —
they never appear in the model context, session history, or trace logs. The
permission gate prompts for approval on every credential-writing call.

Gmail and Calendar tools:

- `gmail.search`, `gmail.read`, `gmail.send`
- `calendar.events`, `calendar.create`

Drive, Docs, and Sheets tools:

- `drive.search`, `drive.meta`
- `docs.read`
- `sheets.meta`, `sheets.read`, `sheets.write`, `sheets.append`

### Connector Policy

Google AI access is governed by a 7-boolean connector policy:

- `aiEnabled` — expose Google tools to AI chat (default: false)
- `gmailEnabled` — expose `gmail_search` and `gmail_read` (default: false)
- `gmailSendEnabled` — expose `gmail_send` (default: false)
- `calendarEnabled` — expose `calendar_events` (default: false)
- `calendarWriteEnabled` — expose `calendar_create` (default: false)
- `driveEnabled` — expose Drive, Docs, and Sheets read tools (default: false)
- `sheetsWriteEnabled` — expose `sheets_write` and `sheets_append` (default: false)

Policy resolves per-field: workspace `.mim/settings.json` → user-global `~/.mim/config.yaml` → defaults. Both locations use the `connectors.google` key.

Settings > Connections provides connection status, a browser-based Google sign-in
button, an advanced manual token form for development/recovery, granted scope
summaries, and policy toggles.

### AI Tool Exposure

Chat tools are conditionally included based on policy, connection state, and granted OAuth scopes:

- `gmail_search`, `gmail_read` — visible when connected, `aiEnabled` and `gmailEnabled` are true, and the token grants Gmail read scope
- `gmail_send` — additionally requires `gmailSendEnabled` and Gmail send scope
- `calendar_events` — visible when `calendarEnabled` is true and the token grants Calendar read/write scope
- `calendar_create` — additionally requires `calendarWriteEnabled` and Calendar write scope
- `drive_search`, `docs_read`, `sheets_meta`, `sheets_read` — visible when `driveEnabled` is true and the token grants Drive or Sheets read scope as appropriate
- `sheets_write`, `sheets_append` — additionally require `sheetsWriteEnabled` and Sheets write scope

Backend policy enforcement runs in the tool execution layer for the `ai` actor, so direct calls cannot bypass disabled policy flags. User and system actors are not filtered by connector policy.

### MCP Exposure

`google.status`, `google.setOAuthClient`, `google.connect`, and `google.disconnect` are always present in the MCP catalog so CLI agents can check status and manage the full connection lifecycle (including browser OAuth). Data tools (`gmail.search`, `gmail.read`, `gmail.send`, `calendar.events`, `calendar.create`, `drive.search`, `drive.meta`, `docs.read`, `sheets.meta`, `sheets.read`, `sheets.write`, `sheets.append`) appear conditionally when a token is configured. MCP calls use the `user` actor, so the AI connector policy toggles do not apply. `settings.get`/`settings.set` are also in MCP so CLI agents can configure policy flags the same way the in-app chat agent does.

### Trace Capture

Google content tools set `captureResult: false`, including Gmail, Calendar reads, Drive/Docs, and Sheets read/write tools. Secret-bearing Google setup tools (`google.setOAuthClient`, `google.setTokenBundle`, `google.exchangeCode`, `google.connect`) never capture params or results.

## Permission Rules

Policies live in `src/main/security/gate.ts`. Whether a tool prompts is decided by its
**effect** (read / mutate / external), not its risk tier — risk now only sets the
approval card's caution styling. All Slack/Google integration tools are
`external`, so they prompt in Normal and Strict.

- Integration reads (search, history, channels, replies, events, Gmail/Drive/Docs/Sheets reads) are `external` → approval in Normal and Strict.
- Outbound send/create/write tools (`gmail.send`, `calendar.create`, `sheets.write`, `sheets.append`, kernel `slack.send`) are `external` and additionally `high` risk, so the card adds a caution treatment.
- Secret setup and OAuth exchange tools mutate stored credentials; `google.exchangeCode` is `external`. `slack.connect`, `slack.disconnect`, `google.connect`, and `google.disconnect` are `secrets`/`high`.
- Status checks (`slack.status`, `google.status`) are treated as reads and do not prompt.
- Packages cannot call personal Slack or Google integration tools in runtime v1.

The event log recursively redacts tokens, keys, secrets, subjects, snippets, message bodies, text, and content-like fields before summaries are persisted.
