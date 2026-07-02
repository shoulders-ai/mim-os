# AI-Native Browser

## Context

Mim has two model-facing web access modes. `web_read`, backed by `web.read`, is
the useful cheap path: it fetches PDFs locally, renders normal web pages once in
Chromium, captures the current DOM, and converts the HTML snapshot to Markdown.
`browser_open` / `browser_act`, backed by `web.live.open` / `web.live.act`, is
the live browser path for interactive pages.

That is not enough for interactive websites. A one-shot parser cannot scroll,
click a cookie banner, type into a search box, press "show more", wait after an
interaction, or recover when a site lazy-loads content below the fold. Treating
the parser as the final browser interface leads to brittle behavior: empty
captures, unclear failures, and human handoff for tasks the agent should do
itself.

The product shape is two web access layers:

1. **Cheap reader**: fast, stateless, mostly one-shot, optimized for ordinary
   public pages, docs, articles, PDFs, and search-result follow-up.
2. **Live browser**: a real browser session the agent can observe and operate
   through readable page snapshots and short action refs.

The live browser is inspired by Markanywhere's architecture:

`real browser -> semantic DOM/accessibility capture -> Markdown with refs -> agent action by ref -> recapture`

Mim should implement this idea directly in TypeScript/Electron. Do not add a JVM
sidecar for this. The core product owns the browser runtime, and MCP exposes the
same compact `browser_open` / `browser_act` surface to external agents.

## Motivation

This feature must be AI-native. The agent should be able to browse the web as an
active user of a page, not as a passive consumer of a parser dump.

AI-native means:

- The agent opens the page itself.
- The agent receives a concise human-readable observation of the visible page.
- The observation exposes obvious controls with stable short refs.
- The agent clicks, types, scrolls, waits, and re-observes without asking the
  user to perform browser chores.
- Human help is reserved for true hard walls: CAPTCHA, MFA, legal/account
  consent, or a site that explicitly requires the user's direct intervention.
- The primary agent-facing page observation is Markdown/plain text, not a nested
  JSON DOM tree.

The user request "look at this website and click the button" should feel like:

```text
Page: Example
URL: https://example.com

Visible:
- Cookie banner: "Let us know you agree to cookies"
- Button [1]: Yes, I agree
- Button [2]: No, take me to settings
- Link [3]: Privacy Policy

Possible next actions: click 1, click 2, scroll down, wait
```

The tool call can be structured internally, but the model's working surface
should be this readable observation with compact refs. Avoid complex nested JSON
as the primary interface.

## Product Shape

### Cheap Reader

Keep `web_read` / `web.read` as the cheap reader.

Responsibilities:

- Read selectable PDFs with local extraction.
- Render normal pages once in a stateless hidden Chromium session.
- Convert captured HTML to cleaned Markdown.
- Return clear errors for timeouts, no-readable-content captures, blocked URLs,
  and unsupported runtime conditions.
- Stay fast and inexpensive.

Non-responsibilities:

- Clicking, typing, scrolling, or solving multi-step page flows.
- Treating `stateful: true` as a general timeout or bot-detection fix.
- Guessing through interactive walls with one snapshot.

### Live Browser

Add a separate compact model-facing browser surface for active browsing.

Initial tool surface:

- `browser_open(url, stateful?, visible?, timeout_ms?, max_chars?, start_from_char?)`
- `browser_act(action, ref?, text?, direction?, amount?, ms?, wait_ms?, max_chars?, start_from_char?)`

`browser_act.action` is one of `observe`, `click`, `type`, `scroll`, `wait`,
`extract`, `show`, `hide`, and `close`.

The exact kernel names can use dots, but the model-facing names should stay
short and action-oriented.

The browser keeps session state:

- Current page URL and final URL.
- Current visible/semantic snapshot.
- Ref registry mapping short refs to live DOM/backend node handles.
- Profile mode: stateless or Website Access profile.
- Visibility: hidden by default, visible when the user needs to watch or complete
  auth/CAPTCHA/MFA/legal-consent steps in the exact AI-controlled session.
- Last interaction and capture diagnostics.

The agent loop is:

1. `browser_open`
2. inspect returned observation
3. decide action from visible refs
4. `browser_act` with `click`, `type`, `scroll`, or `wait`
5. inspect the returned observation, or call `browser_act` with `observe`
6. repeat until enough content is available
7. `browser_act` with `extract` for final cleaned content

## Observation Format

The observation should be optimized for agent reasoning, not for preserving the
DOM. The tool result should expose one readable `observation` field; do not also
return a duplicate `markdown` field. Action refs should be a compact sidecar
capped to refs relevant to the returned text chunk.

Include:

- Page title.
- Current URL.
- Final URL when different.
- View/capture status.
- Concise visible text.
- Headings.
- Links with refs.
- Buttons and controls with refs.
- Form fields with refs, labels, current values when safe.
- Important page state: login wall, verification wall, consent banner, empty
  app shell, loading indicator.

Example:

```text
Page: BBC News
URL: https://www.bbc.com/news

# BBC News

Visible controls:
- Button [1]: Register
- Button [2]: Sign In
- Button [3]: Yes, I agree
- Button [4]: No, take me to settings

Visible content:
- Venezuelans cling to 'glimmer of hope' as rescue window narrows...
- Two boys rescued from Venezuela earthquake rubble...
- Australian man charged with murder...
```

Avoid:

- Raw full DOM dumps as the default model surface.
- Deep nested lists of nodes.
- CSS selectors as the primary action handle.
- Requiring the model to infer click targets from brittle XPath/CSS paths.

Internally the snapshot can retain structured metadata and node handles. The
external contract should be readable Markdown plus compact refs.

## Capture Architecture

Implement a TypeScript/Electron version of the Markanywhere pattern.

Capture pipeline:

1. Read DOM from the live `webContents`.
2. Walk the rendered document, including open shadow roots where available.
3. Annotate visibility and layout:
   - hidden/display-none/visibility-hidden
   - visible text
   - rough block/inline boundaries
   - headings, links, buttons, inputs, form controls
4. Annotate accessibility signals where available:
   - accessible name
   - role
   - disabled/checked/selected/value state
   - focusability/actionability
5. Assign short refs to actionable elements.
6. Store `ref -> live handle` for actions until the next capture.
7. Convert the semantic page snapshot to Markdown/plain text with refs.

Ref behavior:

- Refs are regenerated on each observation.
- A ref is valid only for the latest observation.
- If an action is attempted with a stale ref, return a clear stale-ref error and
  tell the agent to observe again.
- Use action refs, not CSS selectors, for primary model actions.

Action behavior:

- `browser_act({ action: "click", ref })` resolves the ref to the live element
  and performs a real click.
- `browser_act({ action: "type", ref, text })` focuses, clears when
  appropriate, and types.
- `browser_act({ action: "scroll" })` scrolls the page or a focused scroll
  container.
- `browser_act({ action: "wait" })` waits for DOM/network quiet with a hard cap,
  then returns.
- Every action should report whether the page likely changed and whether the
  agent should observe again.

## Website Access

Website Access remains the permission and profile layer for stateful browsing.

Rules:

- `stateful: true` on `browser_open` uses the persistent Website Access profile.
- An unapproved domain triggers the inline permission gate before navigation.
- Approval writes the domain grant before the browser opens the website.
- Redirects to unapproved domains should produce a clear approval error naming
  the redirected host.
- Session cookies, consent, and sign-in state are scoped to approved domains.

Do not ask the user to go to Settings as the normal path. Settings remains the
management surface; chat/browser approval is the primary flow.

## Failure Modes

Failures must be explicit and operational.

Examples:

- `No readable content captured`: DOM exposed no useful text.
- `Website access is not approved for <host>`: permission required.
- `Login required`: visible page is an auth wall.
- `Verification required`: CAPTCHA/security challenge/MFA detected.
- `Stale ref`: page changed; observe again.
- `Action target disabled`: ref exists but cannot be clicked/typed.
- `Navigation timed out`: page did not settle within budget, but include whether
  a partial observation is available.

Never return an empty successful browser read.

## Escalation Policy

Default web strategy:

1. Try cheap reader for ordinary read-only requests.
2. If cheap reader returns no readable content, sparse app shell, consent wall,
   or page interaction is needed, escalate to live browser.
3. If live browser needs Website Access for sign-in/cookies/consent, ask via
   permission gate and continue after approval.
4. If the site presents CAPTCHA/MFA/human legal consent, pause with a concise
   human-needed message.

Human opening the page manually is not the default. It is a last-resort recovery
for hard walls or an optional browser-extension future, not the main browser
architecture.

## Implementation Plan

### Phase 1: Vertical Slice

Build the smallest useful live-browser loop.

- Add a browser session manager in main process.
- Support one active AI browser session per chat/session initially.
- Implement `browser_open` and `browser_act`.
- Use Electron hidden or visible `BrowserWindow` / `webContents` with the same
  URL policy as `web.read`.
- Build DOM capture script returning a semantic observation and ref registry.
- Convert observation to readable Markdown with refs.
- Resolve refs back to DOM elements for click/type through injected JS handles or
  stable element ids held only inside the page/session.
- Add hard timeouts around navigation, observation, and actions.

Success criteria:

- Agent can open a local fixture, observe buttons/links/inputs, click/type by
  ref, re-observe changed content, and extract final text.
- Agent can dismiss a cookie banner on a fixture without user action.
- Stale refs fail clearly.

### Phase 2: Website Access Integration

- Route `stateful: true` live browser sessions through Website Access profile.
- Reuse direct chat permission grants for unapproved domains.
- Block private/loopback/disallowed subrequests.
- Report redirected unapproved hosts clearly.
- Add settings/status visibility for active profile and grants.

Success criteria:

- Agent asks for Website Access from chat, approval grants domain before
  navigation, and the same browser action proceeds.
- Subdomain redirects name the missing host.

### Phase 3: Better Observation

- Add accessible names and roles.
- Add forms, current values, checked/selected state, disabled state.
- Add headings and landmark summaries.
- Add viewport-aware observations: top visible area, currently focused element,
  and enough surrounding text to choose actions.
- Add lazy-load handling: scroll and observe until content stabilizes or a cap is
  reached.

Success criteria:

- BBC returns readable content through cheap reader or live browser.
- Wikipedia redirects are handled with clear domain approval.
- Reddit reports verification/login state clearly instead of empty content.
- X reports sign-in wall clearly.

### Phase 4: Extraction And Auto-Escalation

- Teach `web_read` to recommend/escalate to live browser when appropriate.
- Add `browser_act({ action: "extract" })` to produce clean article/page content
  from the current browser state.
- Add optional link/image extraction controls.
- Add trace diagnostics for capture size, visible text chars, ref count, action
  count, final URL, and failure class.

Success criteria:

- A normal user request like "look up this page" uses cheap reader first.
- A request like "open this site and click the download button" uses live browser
  directly.
- The model does not tell the user to open pages manually except for hard walls.

## Test Plan

Use fixture tests first:

- Static article.
- Cookie banner with accept/reject buttons.
- Search form with input and submit.
- Lazy-loaded list requiring scroll.
- Button that changes page content.
- Disabled button.
- Stale ref after re-render.
- Login wall fixture.
- Verification wall fixture.
- Redirect to unapproved subdomain.

Use real-site QA after fixtures:

- BBC News.
- Wikipedia root and `en.wikipedia.org` redirect.
- Reddit homepage.
- X/Twitter public page.
- GitHub repository page.
- DB Regio Nordost disruptions page.
- A docs site with search.

Assertions:

- No infinite spinner.
- No empty successful result.
- Clear failure class.
- Ref actions work after observe.
- Old refs fail after observe when DOM changed.
- Website Access approval happens before navigation.
- User is not sent to Settings as the normal approval path.

## Non-Goals

- Full CommonMark-compatible browser DOM serialization.
- Pixel-perfect page reproduction.
- CAPTCHA solving.
- Bypassing site terms, MFA, or account controls.
- Making the user manually browse as the normal path.
- Exposing raw nested DOM JSON as the primary model interface.

## Open Design Questions

- Hidden vs visible browser as default. Hidden is less intrusive; visible may be
  better for trust and debugging. Either way the agent must drive it
  autonomously.
- Whether `browser_act({ action: "observe" })` should be viewport-limited by default or whole-page
  summarized by default.
- How much browser state to persist per chat after `browser_act({ action: "close" })`.
- Whether to allow multiple concurrent browser sessions per chat.
- Whether to add a later browser-extension bridge for hard anti-bot sites where
  only the user's existing browser context works.

## Product Principle

Mim's live browser is not a safer-looking parser wrapper. It is an active,
AI-native browsing environment.

When the user asks the agent to use a website, the default answer should be:

> I can open it, inspect it, click the right control, and report back.

Not:

> Please open it yourself, copy the content, or go configure a domain in
> Settings.
