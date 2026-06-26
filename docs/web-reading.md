# Web Reading

Mim exposes one model-facing web reader: `web_read`, backed by the kernel tool
`web.read`.

`web.read` accepts an `http` or `https` URL, blocks private and loopback
addresses, follows redirects manually so every hop is checked by the same URL
policy, and returns a cleaned text payload for the agent to interpret. It does
not classify pages as blocked, logged out, consent-gated, partial, or ready.

## Routing

`web.read` has predictable mechanical routing:

- Selectable PDFs use local PDF extraction through `pdfjs-dist`. A URL is treated
  as a PDF when its path ends in `.pdf` or a best-effort `HEAD` request returns a
  PDF content type. Failed `HEAD` requests fall through to rendered reading.
- Normal pages render in a hidden stateless Chromium window, capture visible
  hydrated DOM through `src/main/web/renderedCapture.ts`, then convert the
  captured HTML with the shared HTML-to-Markdown parser.
- Passing `stateful: true` renders through the Research Browser profile after a
  domain grant exists. Use this only when the user has asked for, or approved,
  saved site state such as login cookies.

The returned shape is intentionally thin: `url`, `final_url`, `title`,
`content`, `content_length`, `source`, `elapsed_ms`, and chunk continuation fields
when the output is truncated. Hidden fallback attempts, page verdicts, cache
metadata, and capture diagnostics are not part of the model-facing contract.

## Research Browser

The Research Browser uses the persistent Electron partition
`persist:mim-research`. Settings > Connections lets the user grant domains,
open a visible setup browser for those domains, remove grants, and clear the
profile.

Workspace Research Browser state in `.mim/settings.json` contains:

- `enabled`: whether Research Browser features are enabled for the workspace.
- `allowedDomains[]`: normalized grant patterns.

Legacy `researchBrowser.sources` data is ignored and dropped on the next
Research Browser settings write.

## Security

Fetch and Chromium-rendered reads share the same URL policy. Initial URLs and
redirect targets must be public `http` or `https` URLs. Hidden Chromium sessions
also install a request blocker so subresource requests to private, loopback, or
otherwise disallowed targets are cancelled.

Package backends cannot call `web.read`, `web.search`, or Research Browser
kernel tools in runtime v1. Packages use `ctx.http` with declared host
permissions.

## Evaluation

`src/main/web/webReadEvaluation.test.ts` is the deterministic 50-site
web-reading evaluation set. It uses real domains with synthetic fixture HTML so
CI stays stable while covering public content, consent walls, login pages, SPA
shells, captcha pages, security checks, site errors, and pages with thin but
still useful content. The evaluation asserts that `web.read` returns content for
the agent to interpret rather than deterministic page-status verdicts.
