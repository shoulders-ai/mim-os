---
id: what-is-mim
title: what is mim
order: 1
sources:
  - README.md
  - docs/workbench-navigation.md
  - src/renderer/components/sidebar/ShellSidebar.vue
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# what is mim

Mim is a desktop application for AI-native research work. It brings together an agent that can read, write, and run code, an editor for long-form documents, and a terminal — in one window. Everything durable is a file on your machine that a colleague could read without Mim installed.

## The window

Mim is one window divided into three panes.

::: rows
- Navigator — the left column. It shows what work exists, where it is, and what state it is in. A fixed cluster at the top gives direct access to Chat, Files, Terminal, and Monitor. Below that, an Apps section lists installed app launchers and detected CLI agents, and an Activity section lists your chats and agent sessions. Settings lives at the bottom.
- Work — the center pane. This is where you act: chat transcripts, terminals, file browsers, search, app views, and configuration all appear here.
- Artifact — the right pane. It holds durable things you are working on or reviewing: documents, PDFs, images, diffs, and reports.
:::

Navigator selects Work. Work can open things into Artifact. The two sides are independent: navigating to a different chat on the left does not disturb the document open on the right.

## Core surfaces

Mim ships three integrated surfaces.

Chat is a conversation with Mim's agent. The agent has access to a registry of tools — reading files, writing code, searching the web, running shell commands — and uses them to carry out your requests. When a tool call would change something or reach an external service, the agent pauses and presents the action for your approval before proceeding. You see what it wants to do, and you decide whether to allow it. You choose the model and effort level, and Mim tracks the cost of each chat.

The editor is the document surface in the artifact pane. It opens text files, PDFs, and file cards as tabs in one tab strip. Text documents support formatting, live preview, comments, citations, export, and ghost suggestions from the agent. PDF and file-card tabs are read-only views. Closing the last tab collapses Artifact to a thin rail; opening a new document restores it.

The terminal is a multi-tab shell in the work pane. You run commands, scripts, and build tools here as you would in any terminal. When Mim detects a CLI agent on your machine — Claude Code, Codex, or Gemini CLI — it can launch that agent as a first-class agent session with its own status, persisted scrollback, and history. These sessions appear alongside your chats in the Activity list.

## Apps and skills

Mim is extensible. Apps add capabilities — custom UI, new tools, specialized workflows — and run in sandboxed iframes, calling the same tool registry scoped by each app's declared permissions. Skills are written workflows the agent loads on demand to handle recurring tasks. Both are covered in [apps](apps) and [agents](agents).

## Where things live

A workspace is a folder that holds one body of work. Inside it, a `.mim/` directory stores file history, chat transcripts, and workspace-level settings. Nothing is stored in a remote database — your files stay on your disk, and your workspace is a plain folder that makes sense without Mim.

::: under-the-hood
Mim is an Electron application built on Vue 3 and the Vercel AI SDK. At its center is a single tool registry: every actor — you clicking a button in the UI, the agent calling a tool, an app making an SDK request — goes through the same registry. Every tool call passes a permission gate and writes a trace entry. The registry is the shared authority for what can happen in a workspace, and the trace is the audit trail of what did happen.

More in [tool catalog](/develop/tools).
:::
