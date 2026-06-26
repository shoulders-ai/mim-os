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
- `slack.connect`, `slack.disconnect`
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

There is no local OAuth callback listener yet. `google.authUrl` returns the consent URL, `google.exchangeCode` stores tokens from a code copied out of the redirect URL, and `google.connect` stores a raw token bundle while caching userinfo profile metadata.

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

Settings > Connections provides connection status, raw-token connect/disconnect controls, granted scope summaries, and policy toggles.

### AI Tool Exposure

Chat tools are conditionally included based on policy, connection state, and granted OAuth scopes:

- `gmail_search`, `gmail_read` — visible when connected, `aiEnabled` and `gmailEnabled` are true, and the token grants Gmail read scope
- `gmail_send` — additionally requires `gmailSendEnabled` and Gmail send scope
- `calendar_events` — visible when `calendarEnabled` is true and the token grants Calendar read/write scope
- `calendar_create` — additionally requires `calendarWriteEnabled` and Calendar write scope
- `drive_search`, `docs_read`, `sheets_meta`, `sheets_read` — visible when `driveEnabled` is true and the token grants Drive or Sheets read scope as appropriate
- `sheets_write`, `sheets_append` — additionally require `sheetsWriteEnabled` and Sheets write scope

Backend policy enforcement runs in the tool execution layer for the `ai` actor, so direct calls cannot bypass disabled policy flags. User and system actors are not filtered by connector policy.

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
