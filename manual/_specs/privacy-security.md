# Spec: privacy & security (order 13)

Purpose: the trust anchor. What leaves your machine, what asks first, what is
recorded, what can be undone. User voice throughout; the human author does the
final voice pass on this chapter.

## Outline

- Opening stance: Mim is local-first. Your files, chats, file history, and traces
  live in the workspace and in `~/.mim/` on your machine.
- What leaves your machine, exhaustively and plainly:
  - prompts and the context you attach go to the model provider you configured
    (your key, their terms);
  - web search queries go to the search provider; page fetches go to the sites;
  - integrations you connect (Slack, Google) exchange data with those services;
  - anonymous telemetry, what it does and does not contain, and the kill switch
    (verify exactly against docs/telemetry.md — this list must be verbatim-faithful);
  - nothing else. Say that sentence only if the sources support it.
- What asks first: the approval gate. Consequential tool calls (writes, external
  calls) ask before running; approval modes and standing grants (verify names and
  semantics in gate source/security.md at user level). Call out that routines use
  their own approval grants and ordinary chat always-allow choices do not expand
  those grants.
- Where secrets live: API keys in `~/.mim/keys.env`; integration tokens in the OS
  keychain; `config.yaml` never holds secrets.
- What is recorded: every tool call by every actor lands in the trace — who, what,
  when, outcome. You can review what agents did (verify the user-facing surface:
  Monitor). Audit is for you, on your machine.
- What can be undone: one paragraph pointing back to [history & recovery](history-recovery).
- Trapdoor: permission gate internals, path classifier, actor modes → /develop.

## Boundaries

This chapter states guarantees; it does not explain mechanics covered elsewhere.
Any claim here that cannot be traced to a source is a defect of the highest
severity — no TODO left in this chapter at publish time.

## Sources

- docs/security.md
- docs/routines.md
- docs/telemetry.md
- docs/observability.md
- docs/integrations.md (token storage)
- README.md (key storage)
- src/main/security/gate.ts (approval modes — verify labels)

## Length

800–1200 words.
