# Web Reading

Mim exposes two model-facing web access modes:

- `web_read`, backed by `web.read`, is the simple stateless reader for ordinary
  pages, docs, articles, PDFs, and search-result follow-up.
- `browser_open` and `browser_act`, backed by `web.live.open` and
  `web.live.act`, are the Markanywhere-port live browser for interactive pages
  and local development servers.

Chat and MCP share this public naming: `web_read`, `web_search`,
`browser_open`, and `browser_act`.

`web.read` accepts an `http` or `https` URL, blocks private, loopback,
link-local, unique-local, unspecified, and cloud metadata addresses, follows
redirects manually so every hop is checked by the same URL policy, and returns a
cleaned text payload for the agent to interpret. It does not classify pages as
blocked, logged out, consent-gated, partial, or ready.

The live browser opens a real Electron `BrowserWindow`, hidden by default unless
`browser_open(..., visible: true)` is requested. The same window can be shown
later with `browser_act({ action: "show" })`; visible sessions include a small
Mim-owned URL bar and reload control above the AI-controlled page. The tool
returns one bounded readable observation field plus a compact `refs` sidecar for
actionable elements visible in that returned chunk. The capture/action contract
is ported from Markanywhere: refs are dense and document-order, links encode refs
as `ref:<id>:<href>`, controls surface a short `ref` attribute, and refs are
valid only for the latest observation. `browser_open` applies the requested
`timeout_ms` budget across
navigation, page-idle detection, and first capture so sites with long-lived
SPA/network activity still return a current observation or a bounded tool error
instead of leaving the chat turn open indefinitely. `browser_act` accepts
`observe`, `click`, `type`, `scroll`, `wait`, `extract`, `show`, `hide`, and
`close`; click/type/scroll actions return a fresh bounded observation after a
short bounded wait. `show` and `hide` toggle the exact AI-controlled browser
session for debugging or user-assisted auth/CAPTCHA/MFA/legal-consent handoff.
`max_chars` defaults to 100000 for observation/extract content, and
`start_from_char` continues through large cleaned page text without reopening the
session. `browser_open` and `browser_act({ action: "observe" })` do not return a
separate `markdown` field; the observation already contains the readable page
text with the page header and chunk continuation hint when needed.

The desktop live browser accepts public URLs plus explicit loopback development
targets: `localhost`, `*.localhost`, `127.0.0.0/8`, and `::1`. This support is
available through Mim chat and through the local `mim mcp` bridge, so CLI agents
can inspect a development server with `browser_open` and continue in the same
session with `browser_act`. Other private-network addresses remain blocked.

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
`persist:mim-browser-session`. A `stateful: true` chat read or live-browser open
for an ungranted domain creates an inline approval request; approving it grants
the exact URL host before the read or live browser navigation runs. The same
approval-order contract is used by headless approval modes. Settings >
Connections remains the management surface for
granting domains manually, opening a visible browser window for login or consent
setup, removing grants, and clearing the profile.

Workspace Website Access state in `.mim/settings.json` contains:

- `enabled`: whether Website Access features are enabled for the workspace.
- `allowedDomains[]`: normalized grant patterns.

The current settings key is `browserSession`.

## Security

Fetch and Chromium-rendered reads share the default URL policy. Initial URLs and
redirect targets must be public `http` or `https` URLs. Hidden Chromium sessions
also install a request blocker so subresource requests to private, loopback,
link-local, or otherwise disallowed targets are cancelled.

The desktop live browser has one narrow exception: when `browser_open` itself
targets a supported loopback host, that session may load loopback HTTP(S) and
WebSocket resources for the local app. A session opened on a public page cannot
reach loopback resources, and loopback sessions still cannot reach private LAN,
link-local, cloud-metadata, or unique-local addresses. Headless/serve mode has no
Electron live-browser driver, so the exception is not available to remote MCP.

Website Access reads add a second request boundary: sign-in, consent, and
cookies may only be used on domains covered by the approved domain patterns for
that workspace. If a main-frame navigation or redirect reaches an unapproved
host, the renderer reports that host as a Website Access approval problem rather
than surfacing Electron's low-level blocked-client error.

Package backends cannot call `web.read`, `web.search`, `web.live.*`, or website-access
kernel tools in runtime v1. Packages use `ctx.http` with declared host
permissions.

## Evaluation

`src/main/web/webReadEvaluation.test.ts` is the deterministic 50-site
web-reading evaluation set. It uses real domains with synthetic fixture HTML so
CI stays stable while covering public content, consent walls, login pages, SPA
shells, captcha pages, security checks, site errors, and pages with thin but
still useful content. The evaluation asserts that `web.read` returns content for
the agent to interpret rather than deterministic page-status verdicts.
