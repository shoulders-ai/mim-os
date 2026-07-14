# Spec: web research (order 7)

Purpose: how the agent reaches the web — search, reading, and the live browser —
and how you control it.

## Outline

- The agent searches the web (`web.search`) and reads pages and web PDFs
  (`web.read`). Results come back as text the agent cites in chat.
- The live browser: for pages that need interaction, the agent opens a real browser
  session (`web.live.open`, `web.live.act`) and acts step by step. Describe at user
  level: what you see, what the agent sees (bounded observations — one plain
  sentence). Include localhost preview support for desktop chat and connected CLI
  agents, plus the public-page-to-localhost isolation boundary.
- Control: website access is permissioned (verify the exact user-facing control in
  Settings > Connections / website access and how approval prompts appear for web
  actions).
- What search requires: the search provider and its key (verify — Exa; where the key
  is set).
- Trapdoor: the two-layer design (cheap reader vs live browser), bounded observations
  and action refs → /develop.

## Boundaries

No academic-database search (Scholar app → apps). No integration accounts like
Google (→ privacy & security mentions connections; depth is /develop).

## Sources

- docs/web-reading.md
- src/main/tools/web.ts
- src/renderer/components/settings/ConnectionsSettingsPanel.vue (website access control)

## Length

600–1000 words.
