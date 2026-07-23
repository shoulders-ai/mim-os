---
id: privacy-security
title: privacy & security
order: 12
sources:
  - docs/security.md
  - docs/routines.md
  - docs/telemetry.md
  - docs/observability.md
  - docs/integrations.md
  - README.md
  - src/main/security/gate.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# privacy & security

This chapter states what leaves your machine, what asks before it runs, where secrets are stored, and what is recorded.

## Local first

Mim is local-first. Your files, chats, file history, and traces live in the workspace and in `~/.mim/` on your machine.

## What leaves your machine

Eight categories of data can leave your machine. Most require your action or a key you configured; app update checks run on their own, and telemetry is anonymous and can be turned off.

**Prompts and context.** When you send a message in chat, your prompt and any attached context go to the model provider you configured -- Anthropic, OpenAI, or Google. You supply your own API key; the provider's terms govern what they do with your data.

**Web search and page reads.** When the agent searches the web, your query goes to the Exa API. When it reads a page, the request goes to that site. Both prompt for approval in Normal and Strict modes.

**Integrations.** When you connect Slack or Google, data flows between Mim and those services -- messages, calendar events, Drive files. Each integration must be connected and its tools individually enabled in Settings > Tools before anything is sent. Every integration call prompts for approval in Normal and Strict modes.

**Apps.** An installed app may contact the hosts declared in its manifest — and only those. Requests to any other host are refused.

**Git and sync.** When you push commits or use managed sync, your workspace content travels to your git remote.

**App updates.** Mim checks GitHub Releases for new versions on startup and every four hours. The check sends the app version and platform — nothing from your workspace.

**App registry.** Browsing or installing apps fetches registry indexes and app packages from their sources, and an account token you add is validated against its registry.

**Anonymous telemetry.** Mim sends anonymous usage counts to a first-party endpoint. Telemetry contains only counts and coarse categories -- event types, app version, and platform. It never transmits file contents, file names or paths, prompts, model outputs, chat text, comments, snippets, search queries, terminal commands, logbook text, keys, tokens, account labels, user identity, workspace identity, trace ids, span ids, trace summaries, trace subjects, trace payload references, or raw error messages. Three ways to turn it off:

- Toggle Usage data off in Settings > Workspace.
- Set the environment variable `MIM_TELEMETRY_DISABLED=1`.
- Edit `~/.mim/telemetry.json` and set `enabled` to `false`.

## What asks first

The approval gate stands between the agent and any consequential action. When the agent calls a tool that would change your workspace or contact an outside service, Mim shows an inline approval card before the action runs. File edits include a diff so you can see exactly what will change.

For ordinary chats, three approval modes are available under Approval mode in Settings > AI & Models:

::: rows
- Strict -- ask before every action, including reads.
- Normal -- ask before changes and outside requests.
- Allow all -- no approval prompts.
:::

Normal is the default.

Sensitive paths -- SSH keys, cloud-provider configs, shell dotfiles and history, credential files, `.env` files, and locations like `.ssh`, `.gnupg`, and `.aws` -- always prompt in Strict and Normal, even when you have granted a standing allow for the same tool. For ordinary chats, Allow all turns this off.

Each approval card offers an always-allow checkbox. Checking it grants that tool for the rest of the current chat. Stopping the chat clears all standing grants.

Routines use their own approval grants. A routine can run unattended only for tools granted by its routine definition; other consequential actions ask in that routine's chat transcript. An always-allow choice in an ordinary chat does not expand a routine's grants.

## Where secrets live

API keys are stored in `~/.mim/keys.env`, a file written with permissions restricted to your user account. You can add, replace, and remove keys in Settings > AI & Models; changes take effect immediately across every AI surface without restarting. Integration tokens for Slack and Google are stored in the OS keychain. `~/.mim/config.yaml` holds identity, model defaults, connector policy, and skill configuration. It never holds keys or tokens.

## What is recorded

By default, every tool call by every actor -- you, the agent, apps -- is recorded in the local trace stream under `.mim/traces/`. Each compact audit entry captures who made the call, what tool ran, when, and the outcome. The audit digest redacts keys, tokens, and content fields. Read-only tool results are not retained as content. Completed model turns and consequential tool results may be kept as compressed, deduplicated local payloads, with secret-bearing tools excluded. File-write details are retained for revert detection while the local audit trail is on.

Settings > Workspace has a Local audit trail toggle. Turning it off asks for confirmation, deletes the existing local audit events and retained content for that workspace, and stops future local trace writes. This does not change anonymous Usage data, which has its own toggle and kill switches. Open Advanced to change retention and budgets, disable optional content capture, inspect storage use, or clean immediately.

Open Monitor in the Navigator to review what Mim, the agent, and apps have done in your workspace. The Monitor tab shows review items -- errors, denials, reverted outputs -- and a narrated list of runs. The Audit tab shows consequential events, with a full-log toggle for the raw stream.

Traces are yours, on your machine. Compact audit events default to 90 days. Retained content expires after 7 days and has a 250 MB soft budget by default. Advanced shows audit and content sizes separately and lets you change retention, budgets, and content capture or run cleanup immediately. Recent file-write details are protected inside the content window, so accountability and revert detection can temporarily exceed the soft content budget.

## What can be undone

Mim keeps file history for every file the agent or an app changes. You can restore any previous version without touching your git repository. See [history & recovery](history-recovery).

::: under-the-hood
The permission gate runs before every tool execution in the registry. A tool's effect -- `read`, `mutate`, or `external` -- determines whether a prompt appears; risk only sets the approval card's caution styling. Path classification (`workspace`, `team`, `sensitive`, `outside-workspace`) is enforced above session allows. The `ai` actor is the only actor that receives interactive prompts; `package` actors are checked against declared permissions and denied for system tools and personal integrations. Team files are writable under the same rules as Project files, with Team-specific approval copy; only the managed Team checkout mount itself is protected. For ordinary AI calls, Allow all bypasses the interactive prompt. Routine context is checked before that bypass.

More in [permission gate](/develop/security).
:::
