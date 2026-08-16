# dsh-plan-graph

An out-of-tree [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin bundle: an interactive flow graph of a session's tool calls and messages, rendered client-side from the conversation snapshot. The plugin adds a "Plan Graph" tab to the session view ring (pan/zoom canvas, status-colored node cards, node details, hide-tool-calls and group-by-turn toggles, follow latest, and "Merge into conversation" into the real right sidebar).

pkg-3 adds three features on top of the graph:

- **Favorites** — a panel centered at the bottom of the view, opened from the toolbar button (colored kind tiles + summary + time). Per-session, persisted as JSON in `localStorage` under `dsh.plan-graph.fav.<sessionId>`, deduped by node id, capped at 100. Add via the node context menu or by dragging a node onto the toolbar favorites button. Click an entry to center the graph on that node with a flash highlight; if the node has left the current window (partial finished, node paged out), the click falls back to the matching chat row by seq/callId. Removal goes through the node context menu.
- **Node context menu** — right-click a node for: add/remove favorite, locate in conversation (tool-call nodes only), copy node info, view details. Closes on outside click, Escape, or canvas interaction. Favorites are managed here (and by dragging a node onto the toolbar favorites button) — there is no ★ button on the details panel.
- **Locate in conversation** — maps a tool-call node to its chat row (`snapshot.chat.nodes` + the `data-chat-flow-key` DOM anchor), waits for the row via `MutationObserver`, scrolls it into view and flashes it; a 10s timeout silently falls back to in-graph locate. Prefers an upstream `chatLocate` optional service when a deployment provides one.

The browser half is the plan-graph dynamic-plugin code (pkg-3), wrapped in the web module loader's handoff format — plain JavaScript, no build-time dependencies. The `prepare` script (which pnpm runs after a git install) regenerates `client.js` from `client.body.js`.

Changes since 0.1.0 (pkg-20): pkg-21 — user/steering nodes display「输入」(input) and context nodes「已完成」(completed) instead of idle; pkg-22 — dragging the canvas no longer selects text (`user-select: none` + `preventDefault` on mousedown); pkg-3 — favorites (persisted, drag-to-add), node context menu, and locate-in-chat; pkg-4 — the graph flash highlight clears itself via the CSS animation's `animationend` (the dynamic client half withholds browser timer globals, so `setTimeout` is not used); pkg-5 — favorites UI is the dropdown-panel form (colored kind tiles + summary + locate pin + details ★ button); pkg-6 — the panel renders centered at the bottom of the view and the per-entry × remove button is dropped; pkg-7 — the context menu reorders so 定位至对话区 (locate-in-chat) sits below the favorites toggle; pkg-8 — the `chatNodeVisibility` service gains `subscribe(fn)` (its consumer calls it during Chat render; without it the conversation page went blank when switching back to Chat); pkg-9 — 定位到图内 removed from the context menu, the details ★ button removed (favorites via context menu only), and favorites entries store the node seq with a chat-row fallback when the node leaves the window; pkg-10 — the locate-pin icon is dropped from favorites rows.

## Install

From a directory that contains this package (or any npm registry / tarball / git host):

```sh
dsh plugin --profile demo add ./plan-graph-bundle
dsh --profile demo
```

- **From GitHub** (sources, not built artifacts — the `prepare` script builds on install): `dsh plugin --profile demo add github:<you>/plan-graph-bundle#<sha>`. pnpm refuses to run the `prepare` script until it is allowlisted — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

  ```yaml
  allowBuilds:
    dsh-plan-graph: true
  ```

  and re-run the `add`. That allowance is permission to execute this package's code on your machine at install time — pin a commit (`#<sha>`) and only install sources you trust.
- **From a tarball** (no build permission needed): `pnpm pack` in this directory, then `dsh plugin --profile demo add ./dsh-plan-graph-0.3.0.tgz`.
- **From npm** (once published): `dsh plugin --profile demo add dsh-plan-graph`.

Verify the layer without booting: `dsh --profile demo --dump-config` shows a `# == dsh-plan-graph` layer.

## What it needs

- The browser half registers into `conversation.view` / `details` through the standard client plugin services (`slots`, `locale`, `layout`), all provided by the dsh web surface.
- "Hide tool calls" provides the optional `chatNodeVisibility` service. The shipped ui-conversation does not consume it yet, so against an unpatched dsh the toggle hides nothing on the chat page (the graph itself honors it); deployments with a ui-conversation that consumes the service get the live chat filtering.
- Fresh sessions keep Chat as the default view; the Plan Graph tab is one click away. A deployment that wants the graph front and center provides the upstream `conversationDefaultView` service itself (`{ id: 'plan-graph' }`).
- "Locate in conversation" reads the shared conversation snapshot and targets the chat row's `data-chat-flow-key` anchor. The anchor is a view-layer contract of the shipped chat view; if a future dsh renames it, the feature silently falls back to in-graph locate rather than erroring.

## Regenerating the client bundle

`npm run prepare` (or `node scripts/build-client.mjs`) rewrites `client.js` from `client.body.js`. Edit the body, never the generated file.
