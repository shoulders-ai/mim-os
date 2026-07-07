---
id: build-on-mim
title: build on mim
order: 1
sources:
  - README.md
  - docs/_MAP.md
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# build on mim

Mim is a desktop runtime for bespoke agentic applications. You extend it by writing apps, skills, tools, and CLI integrations against its tool registry and permission gate. This page is the entry point; each section links to the full reference.

## Apps

An app is an installable capability bundle: backend jobs, AI tools, data storage, and optional iframe UI, declared in a `package.json` manifest with a `mim` block. Apps run under a scoped runtime context that enforces identity, permissions, audit, and cancellation. Headless apps (no UI) are first-class. The full manifest, backend API, SDK, and runtime context are documented in [app system and API](app-system-api). The generated [app catalog](/develop/apps) lists published apps from the mim-apps repository.

## Skills

A skill is a markdown instruction folder (`SKILL.md` plus optional resources) that the agent loads on demand. Skills gate tools: tools listed in `unlocks` stay hidden from chat until the skill activates. Workspace skills, personal skills, added sources, and app-bundled skills each have their own precedence layer. See [skills](skills) for the format, discovery rules, and progressive tool gating.

## Tools over MCP

Mim exposes its tool registry to external CLI agents (Claude Code, Codex, Gemini CLI) through a local MCP stdio bridge. The bridge connects to the running desktop over WebSocket, so CLI agents share the same workspace, approval gate, and trace log. The exposed surface includes file tools, web tools, editor state, integration data tools, and named app tools. See [MCP bridge](mcp) for the tool surface and client setup. The generated [tool catalog](/develop/tools) lists every registered tool with its effect classification.

## Headless CLI

The `mim` binary boots a headless tool registry without Electron. It runs workspace commands, generic tool calls, trace queries, and registry operations from any shell. `mim go` refreshes agent context and launches an external command (defaulting to `claude`) in the workspace. See [command line](cli) for the full command set.

## Workspace contract

Every Mim workspace has a `mim.yaml` config, an `AGENTS.md` system prompt, and a `.mim/` runtime directory. The config declares shared apps, registries, resource collections, and sync mode. See [workspace contract](workspace-contract) for the schema and layout.

## Models

The [model catalog](/develop/models) lists every model in the registry with provider, context window, and pricing.

## Security

The permission gate runs before every tool call. It classifies effects as read, mutate, or external, and prompts the user in normal and strict modes before the agent can run a mutating or external action. Apps are checked against declared manifest permissions. See [security](security) for the gate architecture, actor modes, and path classification.
