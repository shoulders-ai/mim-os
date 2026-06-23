# Design System

This document defines the visual language, layout architecture, and component system for Mim — the chrome gradient, typographic hierarchy, density, and restraint — adapted to a single-window, multi-surface architecture.

---

## 0. Principles

- **Chrome gradient.** Surfaces lighten from shell to content center. Three levels: chrome, chrome-mid, surface. No shadows.
- **Dense.** Compact controls. Tight rows. 8-hour tool. Every pixel earns it.
- **Progressive disclosure.** Calm surface. Deep capabilities. One click from everything.
- **One accent.** Single accent color per theme. Signal only: active states, citations, caret. Never background fill.
- **Seven themes.** Light: White (clean neutral, default), Parchment (warm), Glacier (cool), Sage (botanical). Dark: Slate, Monokai, Nord, Dracula.
- **Five font roles.** Sans (Satoshi) for chrome. Serif (Lora) for content. Mono (JetBrains Mono) for code/data. Slab (Zilla Slab) as editor option. Brand (Georgia) for display copy. The product logo itself is an outlined wordmark, not a runtime font (see `docs/brand/`).
- **Discovered, not designed.** Should feel like an instrument, not a platform.
- **Nielsen Checklist**:
  - keep users informed about what is going on, through appropriate feedback within a reasonable amount of time
    - speak users' language: using words, phrases and concepts familiar to them rather than internal jargon (leaky abstractions) or overly-technical language
    - provide users with control: escape hatches, emergency exits and the ability to reverse course
    - be consistent and standardized: users should not have to worry that words, situations or actions may mean different things
    - prevent error states from occurring in the first place, and check users' intent when engaging in error-prone actions
    - minimize demands on user memory by making options visible, retaining previous context, and importing relevant settings where applicable
    - support experienced power users by providing accelerative shortcuts, personalization, and customization options
    - not contain irrelevant or rarely required information
    - help users identify, understand, and rectify errors
minimize the need for additional explanation (but be accompanied by documentation)


## 1. Design Philosophy

The tool should feel discovered, not designed. Like an instrument, not a platform.

- **Monochrome + one accent.** Each theme uses a single accent color. No secondary accent colors.
- **Chrome gradient.** The outer shell is darker; surfaces lighten as you move inward toward the content. This creates depth without shadows.
- **Typography over decoration.** Weight, size, case, and spacing communicate hierarchy. Borders, fills, and icons are secondary.
- **No shadows.** Depth is communicated through surface color differences and subtle borders. The only exception is functional floating elements (popovers) which may use a border for separation.
- **Balancing density and whitespace.** Controls are compact. Rows are tight. The tool respects screen real estate. But space is left to breathe, for clarity, and focus.
- **Radius is restrained.** Shell icon buttons: 5px. Toolbar mode buttons: 4px. Sidebar rows: 4px. Pills/chips: 999px. Nothing else rounds.

---

## 2. Color System

The entire palette maps to CSS custom properties in `src/renderer/styles.css`. Every color in the UI traces back to one of these variables. Seven themes are available, controlled by a `data-theme` attribute on `<html>`:

| Theme | `data-theme` | Vibe | Accent |
|---|---|---|---|
| White | `white` | Clean neutral light, default | `#2d2d2d` near-black |
| Parchment | `parchment` | Warm light | `#c05d3c` terracotta |
| Glacier | `glacier` | Cool blue-gray light | `#4a7c9b` steel blue |
| Sage | `sage` | Warm botanical light | `#5a8266` forest green |
| Slate | `slate` | Neutral dark | `#5a9e8f` muted teal |
| Monokai | `monokai` | Classic dark | `#f97316` warm orange |
| Nord | `nord` | Arctic cool-blue dark | `#88c0d0` frost cyan |
| Dracula | `dracula` | Deep slate dark | `#bd93f9` violet |

Theme definitions live in `src/renderer/styles.css`. The Tailwind `@theme` block
provides the unresolved-token fallback; the app default is White
(`DEFAULTS.theme` in `stores/settings.ts` plus `data-theme="white"` on
`<html>` in `index.html` so the first paint is correct before settings load).
Each `[data-theme]` selector overrides the full set of `--color-*` tokens.

### Styling rule — TAILWIND ONLY

**All component styling MUST use Tailwind v4 utility classes.** No exceptions for new code. When modifying an existing component, migrate its `<style>` CSS to Tailwind utilities.

Use the project's semantic token classes in templates: `text-ink-3`, `bg-chrome-mid`, `border-rule-light`, `bg-surface`, `text-accent`, etc. These map to the CSS custom properties defined in the `@theme` block below.

**DO NOT:**
- Write `<style>` blocks with `color: var(--ink-2)` or `background: var(--chrome-mid)` — use `text-ink-2` and `bg-chrome-mid` instead.
- Use inline `style=""` attributes for colors, spacing, layout, or typography.
- Invent raw CSS classes for things Tailwind already expresses (`display: flex` → `flex`, `gap: 8px` → `gap-2`, `padding: 12px` → `p-3`).

**The only permitted uses of `<style>` blocks:**
- `@keyframes` animations
- Vendor-prefixed properties (`-webkit-app-region: drag`)
- `:deep()` selectors targeting third-party rendered content (CodeMirror, markdown preview, xterm)

Theme is stored in workspace `.mim/settings.json` under the `theme` key.

### 2.1 Chrome Gradient (3 levels)

The chrome system creates the outside-in depth gradient. Values shown are White (default) theme; each theme overrides them.

```
--chrome:      #ebe9e3    Darkest — header, sidebar edge, shell bg
--chrome-mid:  #f3f1ec    Middle  — sidebar body, hover states
--chrome-high: #f9f8f5    Near-surface — main toolbar
--surface:     #ffffff    Lightest — Work and Artifact content areas
```

In dark themes (Slate, Monokai) the gradient inverts: chrome is near-black, surface is dark gray. The spatial relationship (outer = chrome, inner = surface) stays the same.

**Rule:** Any element on the outer edge of the window uses `--chrome`. Mid-layer docked panels use `--chrome-mid`. Reading/writing surfaces use `--surface`. No additional background levels should be invented.

### 2.2 Ink (text hierarchy)

Four ink values control all text contrast:

```
--ink:   #1a1a18    Primary — headings, active labels, body text in content
--ink-2: #4a4a44    Secondary — body text, hover states, sidebar labels
--ink-3: #8a8a80    Tertiary — toolbar icons, chrome labels, metadata
--ink-4: #b0b0a6    Quaternary — timestamps, disabled hints, inactive icons
```

**Usage pattern:** `--ink` for things the user is reading. `--ink-2` for supporting text. `--ink-3` for UI chrome labels. `--ink-4` for metadata you glance at. Hover states typically shift one level darker (ink-4 -> ink-3, ink-3 -> ink-2, ink-2 -> ink).

### 2.3 Accent

One accent color. No secondary accents.

```
--accent:      #c05d3c               Terracotta — active states, primary actions, caret
--accent-soft: rgba(192,93,60,.12)   Tinted bg — active mode buttons, selected items, banners
--accent-tint: rgba(192,93,60,.10)   Lighter tint — active sidebar rows, selected list items
--accent-ink:  #ffffff               White text on accent fills
```

**Where accent appears:** Active mode button. Resize handle on hover. Primary action buttons (filled). Caret color. Active icon buttons. Active sidebar/Navigator rows. Never as a large fill or background — only as a signal.

### 2.4 Lines and Borders

```
--rule:        #d8d7d2               Structural — major region borders
--rule-light:  #eae9e5               Subtle — header bottom, toolbar bottom, row dividers
--line-soft:   rgba(0,0,0,.04)       Ghost — chrome zone boundaries
--line-hl:     rgba(192,93,60,.06)   Active line — editor cursor line highlight
```

---

## 3. Typography

Five CSS variables, each with a strict role. Never cross roles.

### 3.1 Typeface Map

```
--font-sans:   'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif
--font-serif:  'Lora', 'Georgia', serif
--font-mono:   'JetBrains Mono', ui-monospace, monospace
--font-slab:   'Zilla Slab', 'Georgia', serif
--font-brand:  'Georgia', serif
```

| Role | Variable | Typeface | Where |
|------|----------|----------|-------|
| UI chrome | `--font-sans` | Satoshi | Header labels, sidebar rows, toolbar text, button labels, settings dialog |
| Content body | `--font-serif` | Lora | Chat messages, preview pane body text |
| Code / data | `--font-mono` | JetBrains Mono | Editor source, terminal, file paths, tab labels, cost readouts, timestamps, developer chip |
| Alt body | `--font-slab` | Zilla Slab | Editor font option (user-selectable) |
| Brand display | `--font-brand` | Georgia | Display copy: chat empty-state prompt, settings headings |

The product **logo** is not type-set at runtime. The `mim OS` wordmark and `m`
mark are outlined Satoshi paths generated by the toolkit in
[docs/brand/](brand/README.md). The current Workbench shell does not mount a
global wordmark; workspace identity lives in the Navigator.

### 3.2 OpenType Features

```css
font-feature-settings: 'kern' 1, 'liga' 1, 'onum' 1;
-webkit-font-smoothing: antialiased;
```

---

## 4. Icons

Use the existing Vue icon system for shell controls. Icons inherit
`currentColor` and use `stroke-width="1.8"` or `"2"` for consistency.

Common icon sizes: 14px for header controls, 15px for mode switcher buttons,
12-16px for sidebar.

### 4.1 Collapse / Expand Icon Grammar

The Navigator toggle owns the layout-sidebar pair exclusively:
`IconLayoutSidebarLeftCollapse` (sidebar top chrome) and
`IconLayoutSidebarLeftExpand` (bridged pane header). No other control may use
this family for collapse/expand actions.

Work and Artifact collapse to rails and use the arrow-bar family. The bar
marks the rail edge (left for Work, right for Artifact); the arrow shows the
motion of the pane edge:

| Action | Icon | Glyph |
|---|---|---|
| Collapse Work | `IconArrowBarToLeft` | `\|←` into the left rail |
| Restore Work | `IconArrowBarRight` | `\|→` out of the left rail |
| Collapse Artifact | `IconArrowBarToRight` | `→\|` into the right rail |
| Restore Artifact | `IconArrowBarLeft` | `←\|` out of the right rail |

Each rail carries its restore glyph at its top cap; pane restore never moves
into a sibling pane's header (only the Navigator restore lives in the bridged
header, because the Navigator rail has no expand control of its own). Rail
vertical titles are text only, no decorative icon. `IconArrowsMaximize` /
`IconArrowsMinimize` remain the pane expand / restore-split pair and are
unrelated to rail collapse.

---

## 5. Layout Architecture

### 5.1 Shell Structure

```
+------------------------------------------------------------------+
| SIDEBAR  | WORK HEADER (40px drag) | ARTIFACT HEADER (40px)      |
| (220px   +-------------------------+-----------------------------+
|  chrome  |                         | RESIZE |                    |
|  bg,     | WORK                    | HANDLE | ARTIFACT           |
|  resize- | Chat | Terminal | Files | (6px)  | Editor | Reports   |
|  able)   |                         |        |                    |
+----------+------------------------+--------+----------------------+
```

The shell is a flex row. The Navigator sits at the left edge. Work and Artifact
start at the top edge and own their pane-local 40px drag headers.

### 5.2 The Chrome Gradient

Looking left-to-right:

```
NAVIGATOR edge (chrome) → NAVIGATOR body (chrome-mid) → WORK / ARTIFACT (surface)
```

And top-to-bottom inside Work and Artifact:

```
PANE HEADER (chrome-high) → MAIN CONTENT (surface)
```

The outer frame and Navigator edge use `--chrome`. Pane headers use
`--chrome-high`. Content areas (chat, editor, terminal, package views) use
`--surface`.

### 5.3 Dimension Tokens

```
Heights:
  Sidebar header: 40px
  Pane header:    40px
  Panel status/footer bars: 28px

Widths:
  Navigator:      240px default, 180-320px range, 52px collapsed rail
  macOS safe:     72px minimum top-left header inset
  Work:           remaining space, 336px minimum, 44px rail
  Artifact:       520px default, 336px minimum, viewport-clamped max, 44px rail
  Resize handle:  6px (2px accent line on hover)

Spacing:
  Edge-to-edge: panes run flush to all four window edges — no moat.
  Depth comes from the chrome → chrome-high → surface gradient and 1px
  hairline dividers, not from cards floating on a canvas.
  Root font-size: 14px (styles.css `html`). Navigator is chrome-high in
  both states (the same tone as the pane headers it bridges to). nav-token
  and monogram chips are both 1.75rem so icon tokens and chips share one
  height down the rail/tray — never mix px and rem for these (px literals
  don't scale with the root and drift out of the rem-true icon mirror).
  Header padding: 8px left, 12px right
  Toolbar padding: 6px horizontal
  Gap between controls: 2-4px
```

Inner panel status/footer bars, when present, use `--chrome-high` and a
`--rule-light` top border. Avoid `--chrome` inside Work/Artifact content; it is
reserved for the outer app tray and Navigator background.

### 5.6 Edge-to-Edge Instrument

The workbench is one flush instrument, not floating cards on a canvas.
Navigator, Work, and Artifact run to all four window edges with **no canvas
moat** and **no card rounding** on primary panes or rails. Depth is carried
entirely by the surface gradient (`--chrome` tray → `--chrome-high` header
bands → `--surface` content) and 1px `--rule-light` hairline dividers:

- Navigator ↔ Work: the Navigator's `border-r` hairline (expanded), or the
  bridge melt when collapsed (the rail is a flush chrome-high column and the
  Work header keeps its `border-b`; the Work content carries only the left
  hairline that outlines it against the rail — no top hairline, so the
  surface starts at the same y as the non-bridged state and the chrome band
  does not grow on bridge).
- Work ↔ Artifact: the 6px resize handle is a persistent 1px `--rule-light`
  hairline spanning the pane's full height (chrome-high header band above,
  surface content below); it lifts to `--accent` on hover.
- Work rail ↔ Artifact (or Work ↔ Artifact rail): the railed pane's own
  `border-r` / `border-l` hairline.

Rounding survives only where a surface genuinely floats: dialogs, popovers,
menus, and the WorkspaceSwitcher popover. Pane rails are flush chrome-high
columns (no rounding). The macOS traffic lights are cleared by the bridge
inset on the first pane header (collapsed Navigator) and by the empty
leading space of the Navigator's top chrome (expanded).

### 5.4 Pane Headers

Work and Artifact have pane-local 40px headers with Previous / Next controls,
title, Expand or Restore split, and Collapse to rail. Empty header space is a
window drag region; interactive controls are no-drag. Do not put Work switching
tabs in the Work pane header; Work switching belongs in Navigator.

When the Navigator is collapsed, it becomes a persistent 52px icon rail (the
same `ShellSidebar` at collapsed width, not a separate rail component). The
rail paints a flush-left, flush-top/bottom `--chrome-high` slab — edge-to-edge,
attached to the window's left edge with no canvas moat — and the first expanded pane
header bridges into it: the pane header is `--chrome-high` with no bottom
border, and the pane content
below the header carries a `--rule-light` left/top hairline with no rounding
— one continuous L of chrome wrapping the pane's top and left. The
bridged header pads its leading controls by `NAVIGATOR_HEADER_BRIDGE_INSET` so the
expand-sidebar button sits on the traffic lights' 20px grid, right after the
zoom button. In the normal Navigator-collapsed case the bridged header is
Work; when Navigator and Work are both collapsed, Artifact's header carries
the Navigator restore control (it starts past the lights and needs no inset).
Collapsed Work is restored from its own rail, never from a sibling header. Do
not extend this connection into bottom status/footer bars.

### 5.5 Rails And The Navigator Rail

Collapsed Work and Artifact become 44px rails rather than disappearing. Rails
show a restore icon, vertical title, optional subtitle, and a compact metadata
label. Clicking the rail restores that pane to the normal split.

- Background: `--chrome-high`
- Width: 44px
- Hover: `--chrome-mid`
- Border: `--rule-light` on the edge facing the sibling pane
- Radius: 5px on the exposed edge

The **Navigator rail** is a different object. The Navigator never collapses to a
vertical-title rail; it stays a vertical list of 1.75rem destination tokens at 52px,
painted as a flush chrome-high column (the same tone in both states, edge-to-edge:
no canvas moat) so it reads as one surface with the bridged pane header (§5.4). It does not show the workspace picker or an internal expand
button. Expanded Navigator owns a small collapse button in its top chrome row;
collapsed, the expand control lives in the bridged pane header next to the
traffic lights — never in the footer.

Navigator items use a shared 1.75rem `nav-token` in the same left lane open or
closed; the label tray simply appears to its right. Stable destinations render
as icons; Activity instances render as title-derived monograms with a status
dot. Core surface rows (Chat, Files, Terminal, Monitor) are launchers and
paint the standard active grammar (`--accent-tint` row, `--ink` label,
`--accent` token) when their surface is live, so the tray always confirms the
current surface. Other destination and Activity instance tokens use the same
`--accent-tint` active state; hover = `--chrome-mid` chip. Section markers are fixed 24px rows:
expanded markers show `Work` / `Activity`, collapsed markers show a subtle
divider or reserved space. Marker rows stay mounted so opening the tray reveals
labels without moving following icons vertically.

---

## 6. Component Catalog

### 6.1 Pane Icon Buttons

26x26px square, 5px radius. Default state has no background.

| State | Background | Color |
|-------|------------|-------|
| Default | none | `--ink-3` |
| Hover | `--chrome-mid` | `--ink` |
| Active | `--accent-tint` | `--accent` |

### 6.2 Navigator Rows

Work switching lives in the Navigator, not in the Work pane header. The
Navigator starts with a pinned header cluster — the workspace switcher and
the fixed core-surface cluster (Chat, Files, Terminal, Monitor), flat on the
chrome like every other row, grouped by proximity and ended by one
full-bleed `--rule-light` hairline where the scroll list begins (it darkens
to `--rule` while the list is scrolled) — then
collapsible **Apps** and **Activity** sections. Apps contains enabled app
launchers; the Apps header gear opens Settings > Apps. Activity contains
active chats, agent runs, and package jobs; its header carries right-aligned
History and New chat icon actions. Settings is the only footer row. Navigator
rows are nouns: places, launchers, and instances, never actions. Creation
verbs live in headers and shortcuts, not rows: the Activity header's New chat
icon and the Work pane header action plus Cmd+N create chats, while the Chat
row is the launcher for the draft composer. On collapse, rows survive as rail
tokens; section furniture (labels, toggles, header buttons) drops, with one
exception: the Activity section marker keeps the New chat `+` token so the
rail retains one-click chat creation (History stays expanded-tray only). Rows use the sidebar grammar: 32px row height,
1.75rem token, 7px radius, icon plus label, theme tokens only. Separate groups with
whitespace, not extra borders or card frames. Every row carries its
icon/monogram in the shared 1.75rem `nav-token` lane so it aligns with the
collapsed rail (§5.5); when the tray closes the label is dropped and the row
keeps the same marker/list rhythm.

Do not use left status bars. Express row severity through icon, text, badge, or
selected-row background states instead.

Settings > Apps is configuration, not the Package Manager Work surface. It
prioritizes visibility toggles, permissions, diagnostics, and capability
summaries; package-run history and job launch controls stay out of Settings.

| State | Background | Color |
|-------|------------|-------|
| Default | none | `--ink-2` |
| Hover | `--chrome-mid` | `--ink` |
| Active surface / destination | `--accent-tint` | `--ink` (token `--accent`) |

Core surface rows (Chat, Files, Terminal, Monitor) paint the **same** active
grammar as app and Activity destinations — `--accent-tint` row, `--ink`
medium-weight label, `--accent` token — so the tray always confirms which
surface is live. (The `--accent-tint` wash is tuned to read clearly against
the `--chrome-mid` hover in every theme.)

### 6.3 Automation Approval Mode

Automation approval mode belongs in Settings and chat composer controls, not in
pane headers or file/workspace chrome. Pane headers stay scoped to pane history,
title, expand, collapse, and surface-scoped creation actions (the chat Work
header carries New chat).

### 6.4 Session And Run Rows

Session and package-run rows live together in the flat Activity list. The Chat
row in the Work block is a draft-composer launcher, not a persisted session; it
creates the real chat row only on first send. Active rows open Work. Dragging
any Activity row persists the current mixed order, and new unordered chats or
package runs appear above the manually ordered rows. Context menus expose
rename/archive/delete, and double-click starts inline rename for both chats and
package runs. Active and archived sessions and package runs appear through the
History row in the Work block.

### 6.5 Resize Handles

Invisible 6px hit target. On hover, a 2px `--accent` line appears (150ms transition — the only hover transition allowed). Drag updates width instantly with no transition.

### 6.6 Inline Approval

Permission requests are not modal. When the agent needs to touch the workspace,
the request appears inline in the conversation it belongs to, pinned above the
composer, and never covers the window. The copy is a plain question
(`Allow Mim to edit a file?`) with the one concrete thing to verify shown beneath
it (a workspace-relative path, or the literal command for terminal actions).
For a file change it also carries a one-line, plain-language summary of magnitude
and nature (`Adds 12 lines.`, `Rewrites 4 lines.`, `Deletes this file.`) derived
deterministically from the change — never a model, so it can state size and shape
but makes no claim about meaning. Outbound sends preview their payload (the
message body, the email subject). The exact (already-redacted) tool call sits
behind a quiet `Show details` disclosure — the transparency floor for every tool,
including the long tail with no diff.

Routine edits stay calm; irreversible actions (delete, terminal, outbound sends,
sensitive or out-of-workspace paths) take a quiet caution treatment so they stand
out. Actions: `Decline`, `Approve`, an optional `Always allow … in this chat`,
and — for file changes — `Review change`, which opens the proposed before/after
as a read-only diff in the Artifact editor beside the chat. A request for a
conversation you are not viewing surfaces as the `Approve` status tag in the
Navigator.

### 6.7 Chat Empty Landing

Empty chat sessions use a centered start surface: brand display prompt above the
normal chat composer, with no app launchers or extra cards. The Work pane
Navigator owns app discovery; the empty chat page stays focused on starting the
conversation. Once messages exist, the composer returns to its bottom-docked
timeline position.

### 6.8 Chat Composer Footer

Chat composers may show a quiet footer row below the input. Left side: shield
approval-mode picker with an upward menu — `Strict` (ask before every action),
`Normal` (ask before changes and outside requests), `Allow all` (no prompts;
maps to internal `developer` mode).
Right side: `Done` archives a completed conversation; archived conversations
show `Unarchive` when viewed. The row uses small sans text, `text-ink-3`, 4px
radius hover states, and aligns to the composer width rather than the full pane.

### 6.9 Finished Chat Turns

While Mim is answering, the assistant turn shows the live stream exactly as it
arrives. After the turn finishes, earlier progress and tool details collapse
behind a quiet `Show Details` disclosure above the final answer. The disclosure
summarizes useful outcomes, not hidden text count, for example
`Show Details · edited dummy.md · 2 actions · 10s`.
It is left-aligned and wraps by summary segment; long filenames must break
rather than overflow on narrow screens. Expanding restores the full streamed
turn inline above the final answer. Do not create a separate progress panel.

### 6.10 Issues Board Work Surface

The Issues Board is a dense Linear-like work surface: compact columns, quiet
toolbar, fast modal creation, and in-board issue inspection. Issue cards show
the title, priority icon, and explicit created metadata only. Internal ids,
tags, waiting states, and ambiguous dates are not board card affordances.

An issue is the durable work object. Attached chats and package runs render as
one compact `Chats` list in the issue inspector, with `Start chat` on that row.
Avoid nested Activity/Chats/Package-runs sections and avoid adding metadata
fields beyond status, priority, and due date until their job-to-be-done is
clear.

Opening behavior: create submits back to the board without auto-opening;
single-click opens the in-board issue dialog; `Open in Editor` and
double-click are explicit secondary exits.

### 6.11 Select Controls

`MimSelect` (`src/renderer/components/ui/MimSelect.vue`) is the one shared select
primitive. Use it for every status, priority, sort, and model control — never a
raw `<select>` (browser-default chrome is not themeable), and never Headless UI
imported ad hoc at a call site.

It wraps Headless UI's Listbox (keyboard nav, type-ahead, ARIA, focus return) and
teleports its options to `<body>`, positioned with floating-ui so they flip/shift
to stay on screen and never clip inside an `overflow-hidden` toolbar. The panel
layers at `z-[var(--z-popover)]`, above modals, so a select opened inside a dialog
renders over it.

Props: `v-model` (`string | number`), `options`
(`{ value, label, disabled?, icon?, title?, testId? }[]`), `size` (`sm` 24px
toolbar / `md` 28px form), `tone` (`chrome` / `surface` / `ghost`),
`placement` (`below` / `above` / `auto`), `leadingIcon`, `ariaLabel`. The
`trigger` and `option` slots cover richer rows (model provider icons,
context-window badges, Settings default badges). Class/attr hooks
(`triggerClass`, `optionsClass`, `optionClass`, `triggerAttrs`, `optionsAttrs`)
exist for adapter components and tests; feature code should still import only
`MimSelect`.

The default trigger reproduces the native grammar: `rounded-[4px]`,
`border-rule-light`, `bg-chrome-high` (forms) / `bg-surface` (toolbar),
`hover:bg-chrome-mid`, `focus-visible:border-accent`, `text-ink-2` (md) /
`text-ink-3` (sm). Use `tone="ghost"` only for already-borderless controls like
the composer model/control pickers.

### 6.12 Dialog Controls

`MimDialog` (`src/renderer/components/ui/MimDialog.vue`) is the shared modal
primitive for app dialogs. Use it for Settings, Add Project, approval gates, and
other full modal surfaces instead of hand-rolled `Teleport` + `fixed inset-0`
wrappers.

It wraps Headless UI's Dialog/DialogPanel/DialogTitle so modal surfaces get
portal rendering, focus trap, Escape/outside close requests, `aria-modal`, and
`dialog`/`alertdialog` semantics from one place. It owns the backdrop and
transition. Call sites keep their domain content and close behavior: for example,
approval requests map `close` to deny, while issue creation may ignore close
while a create request is in flight.

Props: `open` (`boolean`), `role` (`dialog` / `alertdialog`), `size`
(`sm` / `md` / `lg` / `xl` / `auto`), `height` (`content` / `fixed`), `align`
(`center` / `top`), `topClass`, `initialFocus`, `panelClass`, `backdropClass`,
`viewportClass`, `title`. Emits: `update:open`, `close`. `height="fixed"` pins
the panel to one viewport-clamped height (`min(720px, 100vh - 64px)`) so
content changes never resize the dialog — Settings (`size="xl"`, 760px wide)
and the issue-detail dialog (`size="lg"`) use it. Use `panelClass` only to
preserve a real existing shell; do not pass per-state size overrides through it
(that is how Settings grew its section-resize bug).

Layering uses the shared z tokens: normal modals use `z-[var(--z-modal)]`;
blocking permission gates use `role="alertdialog"` and `z-[var(--z-critical)]`.
Select popovers intentionally remain above modals at `z-[var(--z-popover)]` so
selects opened inside Settings or issue dialogs are not clipped or hidden.

### 6.13 Action Menus

`MimMenu` (`src/renderer/components/ui/MimMenu.vue`) and `MimMenuItem`
(`src/renderer/components/ui/MimMenuItem.vue`) are the shared primitives for
button-triggered action menus. Use them for workspace switchers, attach menus,
approval-mode pickers, more menus, and similar command lists instead of local
`ref` state, manual outside-click listeners, or inline absolute popovers.

`MimMenu` wraps Headless UI's Menu/MenuButton/MenuItems and teleports the panel
to `<body>`. Floating UI pins it to the trigger and handles viewport
flip/shift, so menus do not clip inside the sidebar, composer, or file toolbar.
The wrapper owns Escape, outside-click close, focus return, menu ARIA, z-index,
and the open/close transition. Feature code should provide only the trigger
content and rows.

Props: `placement` (`bottom-start` / `bottom-end` / `top-start` / `top-end`),
`disabled`, `ariaLabel`, `title`, `triggerClass`, `itemsClass`,
`triggerAttrs`, `itemsAttrs`, `matchTriggerWidth`, `minWidth`, `maxWidth`.
Rows use `MimMenuItem` with `disabled`, `selected`, and `danger`; section
headings and dividers remain plain non-interactive markup inside the menu slot.

Layering uses `z-[var(--z-popover)]`. This is the same tier as `MimSelect`, so
menus opened from dialogs can render above their parent modal without raw
`z-9999` escape hatches.

### 6.14 Context Menus

`MimContextMenu` (`src/renderer/components/ui/MimContextMenu.vue`) is the
shared primitive for right-click menus positioned from cursor coordinates. Use
it for session rows, package-run rows, terminal tabs/surfaces, file rows, and
similar contextual command surfaces instead of local `Teleport` overlays or
document-level pointer listeners.

The primitive teleports to `<body>`, renders a transparent outside-click layer,
clamps the panel inside the viewport, focuses the menu panel, handles Escape and
right-click-outside close, and uses `z-[var(--z-popover)]`. Callers own only the
open state, cursor `x/y`, and domain actions. Use `MimMenuItem` with
`headless=false` for rows so action menus and context menus share row density,
danger state, disabled state, and hover grammar.

Props: `open`, `x`, `y`, `width`, `height`, `clamp`, `panelClass`,
`overlayClass`. Emits: `update:open`, `close`.

### 6.15 Toggle Switches

`MimToggle` (`src/renderer/components/ui/MimToggle.vue`) is the only switch.
36×20px pill, `bg-accent` on / `bg-ink-4` off, `bg-surface` knob,
`role="switch"` + `aria-checked` built in. Used by Settings (Editor section),
Settings > Apps rows, and the Package Manager core-app rows — do not hand-roll
new switch markup; the app previously carried three divergent copies.
Props: `modelValue`, `disabled`, `ariaLabel`. Extra attrs (testids, `title`)
fall through to the button.

### 6.16 Segmented Controls

`MimSegmented` (`src/renderer/components/ui/MimSegmented.vue`) is the shared
pill segmented control for small exclusive choices (approval mode, editor
preview default). 24px-high `bg-chrome-mid` track, 20px `bg-surface` active
segment, 11px sans labels (never 9px mono — safety-relevant options like
"Allow all" must stay legible), `role="radiogroup"`/`role="radio"` semantics.
Props: `modelValue`, `options` (`{ value, label, title? }[]`), `ariaLabel`,
`disabled`.

---

## 7. Interaction Conventions

Native desktop behavior. The app should feel like Sublime/Zed/Linear, not a web page.

### 7.1 Cursor

**Arrow cursor on all controls. Pointer only on `<a>` hyperlinks.**

Do not use `cursor: pointer` on buttons, tabs, icon buttons, sidebar rows, chips, toggles, dropdowns, or any other control. The hover background change is the affordance. This matches macOS native behavior (Finder, System Settings, Xcode).

The only exception: `<a href>` elements that navigate to a URL. Never add `cursor-pointer` to `<button>`, `<div @click>`, or `<span @click>`.

### 7.2 Hover

**Every clickable element must have a visible hover background change.**

Text-color-only hover is not sufficient. If a user cannot tell something is clickable by hovering, it needs a `hover:bg-*` rule.

| Surface | Hover bg token |
|---------|---------------|
| `--surface` | `hover:bg-chrome-mid` |
| `--chrome` | `hover:bg-chrome-mid` |
| `--chrome-mid` | `hover:bg-chrome-high` |

### 7.3 Transitions

**No transitions on hover states.** Hover feedback is instant — native controls don't fade in. CSS transitions belong on layout changes (panel collapse) and content reveals (stream text), never on control hover. The only exception is the resize handle accent line (150ms, functional feedback).

### 7.4 Text Selection

**UI chrome is inert.** `html { user-select: none }` prevents selecting button labels, sidebar text, toolbar buttons. Content areas opt back in: `.cm-content`, `.preview-content`, chat message content, `textarea`, `input`, `[contenteditable]`, `pre`, `code`.

### 7.5 Scroll Isolation

**Scroll contexts are contained.** Every scrollable element uses `overscroll-behavior: contain`. Momentum never bleeds from a sidebar into a parent container.

### 7.6 Focus Rings

**Keyboard only.** Use `:focus-visible` (not `:focus`) for control focus indicators. Click-focus should never show a ring.

### 7.7 Tooltips

All interactive controls should have `title=` attributes for OS-native tooltips. Include keyboard shortcut in the title where applicable (e.g. `"Show Navigator (Cmd+B)"`).

---

## 8. Transitions

```
--transition: 220ms cubic-bezier(.4,0,.2,1)
```

Only layout changes animate (panel collapse/expand). Control hover is always instant.

---

## 9. Scrollbars

Custom thin scrollbars throughout:
- Width: 4px
- Thumb: `--rule` color, 2px border-radius
- Track: transparent

Defined in `src/renderer/styles.css`.
