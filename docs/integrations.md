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

- Client: `src/main/integrations/slack.ts`
- Tools: `src/main/tools/slack.ts`
- Tests: `src/main/integrations/slack.test.ts`, `src/main/tools/slack.test.ts`

Tools:

- `slack.setToken`, `slack.deleteToken`, `slack.status`
- `slack.channels`, `slack.users`, `slack.dms`
- `slack.history`, `slack.search`
- `slack.send`

Chat exposes read-only Slack tools: `slack_search`, `slack_history`, `slack_channels`.

`slack.send` exists as a kernel/CLI tool, is `network`/high risk, and is not exposed to chat.

## Google

Source:

- Client: `src/main/integrations/google.ts`
- Tools: `src/main/tools/google.ts`
- Tests: `src/main/integrations/google.test.ts`, `src/main/tools/google.test.ts`

OAuth tools:

- `google.setOAuthClient`
- `google.setTokenBundle`
- `google.status`
- `google.authUrl`
- `google.exchangeCode`

There is no local OAuth callback listener yet. `google.authUrl` returns the consent URL, and `google.exchangeCode` stores tokens from a code copied out of the redirect URL.

Gmail and Calendar tools:

- `gmail.inbox`, `gmail.search`, `gmail.thread`, `gmail.send`
- `calendar.events`, `calendar.create`

Drive, Docs, and Sheets tools:

- `drive.search`, `drive.meta`
- `docs.read`
- `sheets.read`

Chat exposes Gmail, Calendar, Drive, Docs, and Sheets read tools plus `gmail_send` and `calendar_create`. The two outbound chat tools are high risk and go through the main-process approval gate.

Default Google OAuth scopes are read-only for Gmail, Drive, Docs, and Sheets, plus the explicit outbound scopes `gmail.send` and `calendar.events`.

## Permission Rules

Policies live in `src/main/security/gate.ts`. Whether a tool prompts is decided by its
**effect** (read / mutate / external), not its risk tier — risk now only sets the
approval card's caution styling. All Slack/Google integration tools are
`external`, so they prompt in Normal and Strict.

- Integration reads (inbox, search, history, channels, events, drive/docs/sheets) are `external` → approval in Normal and Strict.
- Outbound send/create tools (`gmail.send`, `calendar.create`, kernel `slack.send`) are `external` and additionally `high` risk, so the card adds a caution treatment.
- Secret setup and OAuth exchange tools mutate stored credentials; `google.exchangeCode` is `external`.
- Status checks (`slack.status`, `google.status`) are treated as reads and do not prompt.
- Packages cannot call personal Slack or Google integration tools in runtime v1.

The event log recursively redacts tokens, keys, secrets, subjects, snippets, message bodies, text, and content-like fields before summaries are persisted.
