# Spec: install (order 2)

Purpose: from nothing to a running Mim with a working AI key.

## Outline

- Download and first launch per platform: macOS (arm64/x64), Windows, Linux
  (AppImage auto-updates; deb and tar.gz are manual). Auto-update: the app updates
  itself through GitHub Releases; state it and move on.
- The one platform note (once, for the whole book): on Windows and Linux, read Cmd as Ctrl.
- AI keys: Mim talks to model providers with your own key. Which providers
  (verify against `resources/ai-models.json`); where to put the key
  (Settings > AI & Models, or the agent can set it via `ai.setKey`); that keys set in
  Settings win over environment variables; that a key change applies live, no restart.
- Where keys live: `~/.mim/keys.env`, on your machine only. One sentence — depth is
  in [privacy & security](privacy-security).
- Trapdoor: key resolution order, `~/.mim/` layout (`config.yaml` never holds keys).

## Boundaries

No workspace creation (→ your first workspace). No model-choice guidance (→ agents).
No build-from-source (that is /develop material).

## Sources

- README.md (Release Builds, AI Key Setup)
- docs/auto-update.md
- resources/ai-models.json (provider list)
- src/renderer/components/settings/sections.ts (exact settings section name)

## Length

600–900 words.
