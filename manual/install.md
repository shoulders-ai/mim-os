---
id: install
title: install
order: 2
sources:
  - README.md
  - docs/auto-update.md
  - resources/ai-models.json
  - src/renderer/components/settings/sections.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# install

This chapter covers downloading Mim, running it for the first time, and connecting it to the providers you need.

::: note
This manual uses macOS keyboard forms throughout: <kbd>Cmd</kbd>, <kbd>Option</kbd>. On Windows and Linux, read <kbd>Cmd</kbd> as <kbd>Ctrl</kbd>.
:::

## Download

Mim is a self-contained desktop app — no additional runtime or dependencies are needed. Installers are published on the project's GitHub releases page.

Builds are available for three platforms:

::: rows
- macOS — Apple Silicon (arm64) and Intel (x64). Open the `.dmg` and drag Mim to Applications.
- Windows — x64 installer. Download and run it.
- Linux — three x64 formats. AppImage is the recommended format and supports auto-update. `.deb` is available for Debian-based distributions. `.tar.gz` is the portable option for systems where AppImage support is missing.
:::

## Updates

Mim updates itself through GitHub Releases. It checks once after startup and again every four hours. When a new version is found, a persistent notification appears with a Download button. After the download finishes, the notification changes to Restart. If you dismiss it, the update installs the next time you quit and reopen Mim.

This automatic flow works on macOS, Windows, and Linux AppImage. Linux `.deb` and `.tar.gz` installs do not auto-update — download the new release manually when one is available.

## AI keys

Mim connects to external providers using your own API keys. No key is bundled or shared — you bring one from each provider you want to use. At least one model key is needed before chat and the editor's AI features work.

Four providers are configured: Anthropic, OpenAI, Google, and Exa. Anthropic, OpenAI, and Google supply the AI models that power chat, editing, and suggestions. Exa provides web search. Each requires its own API key, obtained from the provider's developer site. You only need keys for the providers you plan to use — one key is enough to start.

To add a model key, open Settings (<kbd>Cmd+,</kbd>) and select AI & Models, then paste the key into the provider's field. The Exa key lives in Settings > Connections, under the Search group. Model keys take effect immediately across chat, inline rewrite, ghost suggestions, and apps. No restart is needed. Replacing or removing a key later also takes effect live.

Each configured key appears as a masked value showing a short prefix and suffix. Keys stored by Mim offer Replace and Remove controls. Keys picked up from an environment variable offer Replace only, since removing them means unsetting the variable in the shell that launches Mim.

The agent can also manage keys during a chat. The `ai.setKey` tool adds or replaces a key; `ai.clearKey` removes one. Both write to the same store that Settings uses.

Keys are stored in `~/.mim/keys.env`, on your machine only. The full key never leaves the main process — Settings displays only a masked fragment. More on how Mim handles your data is in [privacy & security](privacy-security).

::: under-the-hood
The key resolver checks two locations in order:

1. `~/.mim/keys.env` — the file that Settings and `ai.setKey` write.
2. Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `EXA_API_KEY`.

The app-managed file always wins. A key set in Settings takes effect even when a different value for the same variable is exported in the shell that launched Mim.

The global `~/.mim/` directory holds your user-level state:

- `keys.env` — API keys, managed by Settings and `ai.setKey`.
- `config.yaml` — identity and model defaults. Never holds API keys or integration tokens.
- `instructions.md` and `skills/` — your reusable Personal instructions and skills.
- `team/` — the connected Team checkout, when configured.

Integration tokens for connected services live in the OS keychain, not in any file under `~/.mim/`.
:::
