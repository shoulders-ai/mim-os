# Package Runtime And Job SDK

Status: core subsystem implemented, including `ctx.http` and `ctx.secrets`;
sandboxed execution and package-tool settings remain follow-up work.

This document defines the target architecture and TDD plan for the package
runtime. The package system is the reason this repo exists: Mim should be
a local-first desktop runtime for bespoke workflow software, not a fixed app
with a plugin drawer.

## Objectives

The runtime must make packages feel first-class, safe, and pleasant to build.

- Packages are installable capability bundles. UI is optional.
- A package may contribute views, jobs, AI tools, filesystem skills
  (`skills/<name>/SKILL.md`, see [skills.md](skills.md)), templates, data
  collections, or any combination of those.
- Headless packages must work. Example: a `stats-checker` package can add chat
  tools without ever opening a package view.
- Package backend code runs through a runtime context that enforces package
  identity, permissions, audit, output limits, cancellation, and data scoping.
- Package UI uses a small SDK, not raw tool registry calls as the normal path.
- The general chat agent can use enabled package AI tools exactly like core
  tools, with clear provenance and user control.
- Job execution is visible, cancellable, recoverable, and auditable.

Design bar: the package runtime should be the best-engineered subsystem in the
repo. DX should feel boring in the best way: small concepts, normal JavaScript,
excellent errors, and no framework ceremony.

## Product Principles

- Visibility: users can see what package is running, what it is doing, and what
  tools it has made available to chat.
- Mapping: each user action maps to one clear runtime action: start job, cancel
  job, enable tool pack, activate skill.
- Constraints: dangerous actions are constrained by manifest permissions,
  runtime identity, and approval gates before damage can happen.
- Recovery: failed jobs keep a run summary and timeline. The user can retry from
  a known state instead of guessing what happened.
- Normal code: package authors write JavaScript modules that export jobs and
  tools. The manifest stays small and static. Skills are markdown files.
- Great errors: every package-runtime error should name the package, capability,
  action, and fix when possible.

## Package States

Package state is intentionally split into separate concepts:

| State | Meaning |
|---|---|
| Installed | The package exists on disk and has a readable manifest. |
| Enabled | The workspace or user has allowed the package to contribute capabilities. |
| Loaded | The backend module has been imported and descriptors are available. |
| Active | A view, job, or tool call from the package is currently in use. |

Installed does not imply enabled. Enabled does not imply UI is open. Headless
tool and skill packages are expected.

## Manifest V1

The manifest is a stable envelope, not the programming model. It answers only
questions the shell must know before executing package code: identity, view pane
roles, backend entry, compatibility, and declared permissions.

Use `package.json` with a `mim` block:

```json
{
  "name": "@mim/stats-checker",
  "version": "0.1.0",
  "type": "module",
  "mim": {
    "manifestVersion": 1,
    "id": "stats-checker",
    "name": "Stats Checker",
    "description": "Statistical review tools for chat and data workflows.",
    "icon": "SC",
    "views": [],
    "backend": "./backend/index.mjs",
    "permissions": {
      "workspace": { "read": true, "write": false },
      "ai": true,
      "http": ["api.openalex.org", "*.crossref.org"],
      "secrets": []
    },
    "engines": {
      "mim": "runtime-v1"
    }
  }
}
```

Rules:

- Each view must declare `role: "work"`, `"artifact"`, or `"either"`.
- Work views appear in Navigator and open in the Work pane.
- Artifact views are opened only by explicit Work-surface actions.
- `views` is optional and may be empty.
- `backend` is optional. A UI-only package does not need backend code.
- Permissions are declarative because the shell must know them before loading
  backend code.
- Jobs, tools, data collections, and workflow schemas do not belong in
  manifest v1. They are backend exports. Skills are `skills/<name>/SKILL.md`
  files, not exports.
- Normal `package.json` keys are allowed. Unknown keys inside `mim` should
  fail validation, except `x-*` extension keys.
- There is no separate manifest format in v1.

This avoids a fragile mini-language while preserving static discovery and
permission review.

## Backend Capabilities

Backend code is normal JavaScript. The runtime imports the backend module only
when the package is enabled and capabilities are needed. V1 must accept plain
descriptor objects so package authors do not need a build step or a helper
dependency.

```js
export const jobs = {
  checkCsv: {
    label: 'Check CSV',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    },
    concurrency: 'single',
    async run(ctx, input) {
      await ctx.progress.step('Reading data')
      const csv = await ctx.files.readWorkspaceText(input.path)
      const report = runChecks(csv)
      await ctx.data.collection('reports').put(ctx.job.runId, report)
      return report
    }
  }
}

export const tools = {
  checkDataset: {
    label: 'Check dataset',
    description: 'Inspect a CSV for missingness, impossible values, and statistical anomalies.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    },
    audience: ['chat'],
    async execute(ctx, input) {
      const csv = await ctx.files.readWorkspaceText(input.path)
      return runChecks(csv)
    }
  }
}

```

Later, `defineJob` and `defineTool` can be added as optional
descriptor helpers for stronger editor autocomplete and clearer authoring
errors. They should remain zero-magic helpers, not a framework requirement.

## Architecture

```txt
PackageLoader
  reads package.json mim blocks
  validates static manifest
  reports installed packages and diagnostics

EnabledPackageStore
  records which packages are enabled for this workspace
  persists under .mim/packages/enabled.json

PackageRuntime
  imports enabled backend modules on demand
  validates exported jobs and tools
  builds package-scoped runtime ctx

CapabilityRegistry
  indexes enabled package jobs/tools
  exposes descriptors to package UI, chat, and command surfaces

PackageJobRunner
  starts/cancels jobs
  emits progress events
  persists run summaries and timelines
  keeps ephemeral runs in memory only, no record

PackageServer + SDK
  serves package views
  authenticates launch tokens
  routes runtime RPC and job events

Chat Tool Builder
  combines core tools with enabled package chat tools
  executes package tools through PackageRuntime ctx
```

## Identity And Trust

Current package WebSocket identity is claim-based. Runtime v1 must replace it
with launch tokens.

Flow:

1. Renderer asks main for a launch URL for package view `stats-checker`.
2. Main creates a short-lived launch token bound to package id and view id.
3. Iframe loads `/packages/stats-checker/index.html?launch=...`.
4. SDK identifies with the launch token.
5. Server binds that WebSocket connection to the package identity.

Requirements:

- A package iframe cannot forge another package id.
- Tokens are bound to package/view identity. An unused token must complete a
  first identify within a short window (60s); after a successful identify the
  token stays valid for the server lifetime, because the renderer keeps iframe
  launch URLs alive indefinitely and iframe reloads / SDK reconnects replay the
  same token. (See "Package launch tokens" in `docs/gotchas.md`.)
- Backend job/tool calls from package UI never accept a forged `packageId` from
  caller params. The runtime injects identity from the authenticated context.
- Package tools and jobs are unavailable when the package is disabled.
- Package file access is constrained by declared manifest permissions before it
  reaches the normal approval gate.

## Runtime Context

Backend jobs and tools receive a package-scoped context:

```js
ctx.package        // { id, name, version, source }
ctx.job            // { id, runId, startedAt } for jobs, null for tools
ctx.inputs         // frozen input object for jobs
ctx.data           // kv and collection storage
ctx.files          // package resource reads and workspace text reads
ctx.ai             // model calls through main-process key resolver
ctx.documents      // document helpers such as DOCX read/annotate and PDF text extraction
ctx.http           // permission-checked fetch
ctx.secrets        // manifest-declared keychain secrets
ctx.progress       // step, log, progress, done
ctx.audit          // explicit audit records
ctx.abort          // signal, aborted, throwIfAborted()
ctx.tools          // constrained calls into core tool registry
```

Current runtime implements `package`, `job`, `inputs`, `data`, `files`,
`progress`, `audit`, `abort`, constrained `tools`, `ctx.ai.generateObject`,
`ctx.ai.callAnthropic`, `ctx.ai.callGemini`, `ctx.documents.docx`,
`ctx.documents.pdf`, `ctx.http`, and `ctx.secrets`. `ctx.http` enforces the manifest host allowlist and HTTPS
(`src/main/packages/packageHttp.ts`); `ctx.secrets` reads and writes manifest-declared
keychain secrets (`src/main/packages/packageSecrets.ts`). See
[package-system-api.md](package-system-api.md) for the contract details.

Document helpers are intentionally under `ctx.documents`, not directly on the
core context. They still call main-process tools, so path checks, package
permissions, approval policy, and audit behavior stay centralized.

## Package Data

Workspace-scoped data lives under:

```txt
{workspace}/.mim/packages/{packageId}/
  data/
    kv/
    collections/
  runs/
```

V1 storage should use atomic JSON file writes:

```js
await ctx.data.kv.get('settings')
await ctx.data.kv.set('settings', value)
await ctx.data.kv.delete('settings')
await ctx.data.kv.keys()

const reports = ctx.data.collection('reports')
await reports.put(id, value)
await reports.get(id)
await reports.delete(id)
await reports.list()
```

Use file-backed JSON first. Do not introduce SQLite for package data until a
real package proves query needs that JSON cannot satisfy cleanly.

## Job Runner

Job runner API:

```js
runtime.jobs.start('checkCsv', { path: 'data.csv' })
runtime.jobs.cancel(runId)
runtime.jobs.get(runId)
runtime.jobs.list()
runtime.jobs.on(runId, callback)
```

Run lifecycle:

```txt
queued -> running -> completed
                  -> failed
                  -> cancelled
```

Events:

```txt
job.started
job.step
job.log
job.progress
job.done
job.failed
job.cancelled
```

Rules:

- Default concurrency is one active run per `{packageId, jobId}`.
- Jobs receive an `AbortSignal`.
- Cancellation is reflected in UI immediately, even if cleanup continues.
- Every run stores a summary and event timeline under package run storage.
- Job errors include package id, job id, run id, and original error message.

## Package Tools In Chat

Enabled package tools become first-class chat tools:

```txt
core.search
core.fs.read
pkg_1a2b3c4d__checkDataset
pkg_5e6f7a8b__searchLiterature
```

Execution flow:

```txt
chat tool builder asks CapabilityRegistry for enabled chat tools
  -> AI SDK receives collision-safe package tool definitions
  -> model calls pkg_1a2b3c4d__checkDataset
  -> PackageRuntime builds ctx for stats-checker
  -> tool executes with permissions, audit, output caps, cancellation
  -> ChatMessage renders the same tool-call UI with package provenance
```

UX requirements:

- Installed package tools are not silently available. The package must be
  enabled.
- Tool calls show provider: "Check dataset, provided by Stats Checker."
- Permission prompts name the package: "Stats Checker wants to read data.csv."
- Tool settings can disable a package or individual package tool.
- Audit records include package id and tool id.

## Skills

Package skills are filesystem skills: `{package}/skills/<name>/SKILL.md` in the
format described in [skills.md](skills.md), available only while the package is
enabled (loading not yet wired). Backend `export const skills` is ignored.
Skills may reference package tools, which still execute under package identity
and permissions.

## SDK Shape

`sdk/mim.js` should grow from raw RPC into a small product SDK:

```js
runtime.package.id
runtime.package.name

runtime.jobs.start(jobId, inputs)
runtime.jobs.cancel(runId)
runtime.jobs.get(runId)
runtime.jobs.list()
runtime.jobs.on(runId, callback)

runtime.data.kv.get(key)
runtime.data.kv.set(key, value)
runtime.data.collection(name)

runtime.tools.list()

runtime.workbench.openWork(viewId)
runtime.workbench.openRun(runId)
runtime.workbench.openArtifact(viewId)

runtime.call(method, params) // escape hatch
runtime.on(event, callback)
runtime.off(event, callback)
```

`runtime.call()` remains for low-level escape hatches, but it should not be the
happy path for jobs, data, tools, or Workbench navigation.

Package skills use the filesystem skill system: `{package}/skills/<name>/SKILL.md` with canonical id `packageId:name`. See [skills.md](skills.md).

## Decisions

Settled for v1:

- Use `package.json` with a small `mim` block as the static manifest.
- Keep jobs and tools in backend JavaScript exports, not in the manifest.
  Skills are `skills/<name>/SKILL.md` files (see [skills.md](skills.md)).
- Support headless packages.
- Allow enabled package tools to become first-class chat tools even when no
  package UI is active.
- Execute backend modules in the Electron main process initially. Revisit
  worker or child-process isolation when untrusted third-party packages become a
  real requirement.
- Store package data and run history as workspace-scoped JSON files first.
- Use launch tokens for package iframe identity.

