# Web Reading

Mim has two web-reading layers:

- `web.read` is the direct HTTP reader. It fetches HTML/plain text or selectable PDFs, blocks private/loopback URLs, extracts HTML with Readability plus the shared HTML-to-Markdown parser, and extracts PDFs locally with `pdfjs-dist`.
- `web.readAuto` is the default agent reader for websites. It renders the page in Chromium, waits adaptively for content/readiness, classifies clear blockers, falls back to the persistent Research Browser profile for configured sources, and can return a recent workspace cache entry when the live page needs attention.

## Research Browser

The Research Browser uses the persistent Electron partition `persist:mim-research`. The user grants domains in Settings > Connections, opens the setup browser when a source needs login/consent/session state, and the agent later reads the same source asynchronously through the saved browser profile.

Source state is stored in `.mim/settings.json`:

- `allowedDomains[]` is the grant list.
- `sources[]` is the health list shown in Settings > Connections.
- Source status is `ready`, `needs_attention`, or `not_configured`.

`web.readAuto` records blocked unconfigured sources with `source_not_configured`, `source_domain`, and `setup_url`. Configured sources that still render login, consent, captcha, security verification, site errors, or truly empty captures become `needs_attention`.

## Partial Captures

Rendered reads do not treat readiness timeouts as hard failures. If a page is still changing, exposes very little content, or the capture budget ends before readiness is certain, the reader returns the best captured Markdown with `status: "partial"`, `attention_required: false`, and `capture` evidence:

- `capture.status` is `complete` or `partial`.
- `capture.confidence` is `high`, `medium`, or `low`.
- `capture.reason` explains why readiness was uncertain.
- `capture.signals` includes elapsed time, timeout/stability flags, visible text length, and visible link/button/form/table/heading/image counts.

The agent should inspect this evidence, answer from the captured content when reasonable, or retry with a larger `timeout_ms` for slow SPAs. A partial capture alone is not a reason to interrupt the user. Research Browser setup is the right next step only when the evidence points to missing access, session state, consent, or authentication.

## Cache

Successful complete default reads are cached in `.mim/web-read-cache.json`. Partial captures are not cached as clean reads. A cache entry is used only after a fresh live read needs attention and only for default reads without link/image extraction. Cached fallback returns `source: "cache"` plus `cache.cached_at` and adds a cache attempt after the live attempt. Source health still records the live blocker, so the UI can surface setup work without interrupting the agent response.

The cache is bounded, URL-normalized without fragments, and currently expires after six hours.

## Evaluation

`src/main/web/webReadEvaluation.test.ts` is the deterministic 50-site web-reading evaluation set. It uses real domains with synthetic fixture HTML so CI stays stable while covering public content, consent walls, login pages, low-content SPA shells such as Linear, captcha pages, security checks, site errors, partial captures, and configured Research Browser recovery.
