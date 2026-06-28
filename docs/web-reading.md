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
  captured HTML with the shared HTML-to-Markdown parser. The renderer keeps a
  capture reserve so pages that never reach a clean loaded state can still yield
  an already-readable DOM.
- Passing `stateful: true` renders with Website Access after a
  domain grant exists. Use this only when the user has asked for, or approved,
  Mim using sign-in, consent, cookies, or other site access already set up for
  that website. It is not a general fix for timeouts, bot detection, extraction
  bugs, or pages that require an active account session.

The returned shape is intentionally thin: `url`, `final_url`, `title`,
`content`, `content_length`, `source`, `elapsed_ms`, and chunk continuation fields
when the output is truncated. Hidden fallback attempts, page verdicts, cache
metadata, and capture diagnostics are not part of the model-facing contract.

The rendered path has hard wall-clock guards around navigation, page-readiness
JavaScript, and DOM capture. The AI-facing `web_read` wrapper also has its own
timeout so a stuck browser call returns a tool error instead of leaving the chat
turn open indefinitely. A rendered read that exposes no readable Markdown fails
with a `No readable content captured` error instead of returning an empty
successful result.

## Website Access

Website Access uses the persistent Electron partition
`persist:mim-browser-session`. A `stateful: true` chat read for an ungranted
domain creates an inline approval request; approving it grants the exact URL
host before the read runs. The same approval-order contract is used by headless
approval modes. Settings > Connections remains the management surface for
granting domains manually, opening a visible browser window for login or consent
setup, removing grants, and clearing the profile.

Workspace Website Access state in `.mim/settings.json` contains:

- `enabled`: whether Website Access features are enabled for the workspace.
- `allowedDomains[]`: normalized grant patterns.

The current settings key is `browserSession`.

## Security

Fetch and Chromium-rendered reads share the same URL policy. Initial URLs and
redirect targets must be public `http` or `https` URLs. Hidden Chromium sessions
also install a request blocker so subresource requests to private, loopback, or
otherwise disallowed targets are cancelled.

Website Access reads add a second request boundary: sign-in, consent, and
cookies may only be used on domains covered by the approved domain patterns for
that workspace. If a main-frame navigation or redirect reaches an unapproved
host, the renderer reports that host as a Website Access approval problem rather
than surfacing Electron's low-level blocked-client error.

Package backends cannot call `web.read`, `web.search`, or website-access
kernel tools in runtime v1. Packages use `ctx.http` with declared host
permissions.

## Evaluation

`src/main/web/webReadEvaluation.test.ts` is the deterministic 50-site
web-reading evaluation set. It uses real domains with synthetic fixture HTML so
CI stays stable while covering public content, consent walls, login pages, SPA
shells, captcha pages, security checks, site errors, and pages with thin but
still useful content. The evaluation asserts that `web.read` returns content for
the agent to interpret rather than deterministic page-status verdicts.
