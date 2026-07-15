---
id: web-research
title: web research
order: 7
sources:
  - docs/web-reading.md
  - src/main/tools/web.ts
  - src/renderer/components/settings/ConnectionsSettingsPanel.vue
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# web research

Mim's agent can search the web, read pages, and drive an interactive browser session. Results come back as text the agent cites in chat.

## Search

The agent searches the web with `web.search`. It sends your query to Exa and returns results with a title, URL, and snippet. Search requires an Exa API key — see the setup section below.

## Reading pages

The agent reads any public URL with `web.read`. PDFs use local text extraction. Ordinary pages render in a hidden browser, and the result is cleaned text the agent can interpret and cite. Long pages are returned in chunks; the agent requests the next chunk to continue reading.

When you need the agent to read a page that requires sign-in, cookies, or consent, it uses website access. The agent passes `stateful: true` to `web.read`, which reads through the persistent browser profile for domains you have granted. If the domain is not yet granted, Mim asks for your approval before the tool call proceeds. Approving it grants the domain and the read continues.

## The live browser

For pages that need interaction — filling forms, clicking through workflows, navigating single-page apps — the agent opens a live browser session with `web.live.open` and acts step by step with `web.live.act`. Available actions are `observe`, `click`, `type`, `scroll`, `wait`, `extract`, `show`, `hide`, and `close`. Actions that change the page — clicking, typing, scrolling, waiting — return a fresh observation of the result; `observe` captures the current state on demand.

The live browser can also preview local development servers on `localhost`, `*.localhost`, `127.0.0.0/8`, and `::1`. This works from Mim chat, from CLI agents connected through `mim mcp`, and from Mim-launched Pi sessions through their built-in tool adapter; ask a CLI agent to use Mim's `browser_open` tool for the preview. Mim allows local HTTP and development WebSocket traffic only when the browser session was opened on a local address. A public page cannot use the browser to reach localhost, and private-network addresses remain blocked.

The browser window is hidden by default. When visible, it shows a URL bar and reload control above the page the agent controls. You can ask the agent to show the window so you can watch its progress, or to hand off for steps that need you — a CAPTCHA, multi-factor authentication, or a legal consent screen. Once you complete the manual step, the agent resumes from the current page state.

The live browser also supports website access. Passing `stateful: true` to `web.live.open` uses the persistent profile for granted domains, with the same inline approval flow as `web.read` for ungranted domains.

## Website access

Website access is a persistent browser profile — sign-in, consent, and cookies — scoped to domains you grant. The agent can only use this profile for granted domains. Everything else uses a stateless, isolated browser.

You manage website access in Settings > Connections. The Website Access group shows whether the profile is available and how many domains are granted. To grant a domain, type it into the domain field — exact domains like `example.com` or wildcards like `*.example.com` — and add it. The Domains group lists every granted domain. For each one you can open a browser window to complete sign-in or consent setup, or remove the grant. The Profile group lets you open a browser window for general setup or clear all website access data.

::: note
Website access data is used only for granted domains. Clearing the profile removes all stored sign-in, consent, and cookie data at once.
:::

## Setting up search

Web search is powered by Exa and requires an API key. You can add or replace the key in Settings > Connections under the Search group; a key added there wins over the `EXA_API_KEY` environment variable. The group shows the Exa Search provider and its current status. Free keys are available at dashboard.exa.ai. If no key is configured, `web.search` returns an error explaining where to add one.

::: under-the-hood
Web access has two layers. The stateless reader (`web.read`) handles the majority of pages: it renders in a hidden browser, captures the hydrated DOM, and converts it to cleaned text. The live browser (`web.live.open` / `web.live.act`) is heavier — it keeps a real browser session open and returns bounded observations with compact element refs. The agent uses refs to click and type without coordinates; scrolling is by direction and distance. Refs are valid only for the latest observation, and each new observation carries fresh refs.

More in [tool catalog](/develop/tools).
:::
