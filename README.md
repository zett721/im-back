# Git Tree Todo

Desktop todo tool with a Git-style node tree and function-like "return to parent" workflow.

## Features

- Top-down node graph with connectors (Git-style branch readability).
- Complete/Delete current task -> focus automatically returns to parent.
- Minimal desktop overlay UI: only nodes and connecting lines.
- Edge docking: drag window to left/right edge to auto-snap and shrink.
- Session archive model:
  - During runtime, writes a continuous event log.
  - On next app start, previous `active.json` is snapshotted and a new tree starts.
- Soft delete + Undo/Redo.
- Tray controls: show/hide, always-on-top toggle, open history, quit.

## Run

```bash
npm install
npm run start
```

## Test

```bash
npm run test
```

## Data layout

Stored under Electron `userData/sessions`:

- `active.json`
- `YYYY-MM-DD_HH-mm-ss.events.log`
- `YYYY-MM-DD_HH-mm-ss.snapshot.json`

## Shortcuts

- `Ctrl+N`: add child
- `Ctrl+Shift+N`: add sibling
- `Enter`: rename focused node
- `Ctrl+Enter`: complete focused node (return to parent)
- `Delete`: delete focused node (return to parent)
- `Ctrl+Z / Ctrl+Y`: undo / redo
- `Ctrl+H`: toggle history panel

## Input behavior

- Press `+`, `=` or shortcut keys, then type task name in the small floating input near the focused node.
- `Enter` confirms, `Esc` cancels.

## Mouse passthrough

- Transparent empty area now passes mouse to desktop.
- Hover node/editor/history area to interact with the app.
