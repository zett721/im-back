# I'm back 🌿

> **[中文](README.zh.md)** | English

> A desktop task-tree widget that works like a call stack — complete a task and **return** to its parent, just like a function returning to its caller.


![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/electron-33-47848f?logo=electron)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What is this?

**I'm back** is a minimal, always-on-top desktop widget for managing hierarchical tasks. It renders your task tree in a Git Graph style — a vertical trunk with coloured branch lines — and keeps you focused on *one node at a time*.

The core idea: instead of a flat to-do list, tasks form a **tree**. When you finish a task, focus automatically moves back up to the parent. Like a call stack popping a frame.

![screenshot](Forshow.png)

---

## Features

- **Git Graph visualisation** — vertical trunk, coloured branch lines drawn on Canvas.
- **Call-stack focus model** — complete or delete a task → focus returns to parent automatically.
- **Minimal widget UX** — only dots are visible by default; hover a node to reveal its title and action buttons.
- **Mouse passthrough** — transparent areas let clicks fall through to the desktop beneath.
- **Edge snapping** — drag the window to the left or right screen edge to auto-dock and collapse.
- **Click-to-translate** — click the drag handle (⠿) to open an inline EN ↔ ZH dictionary powered by MyMemory.
- **Session persistence** — press `Ctrl+S` to save; next launch resumes exactly where you left off.
- **Session history** — every session is auto-archived as a snapshot. Open the history panel (`Ctrl+H`) to browse past sessions as visual cards and **restore any of them** with one click.
- **Soft delete + undo/redo** — up to 200 steps of full-snapshot undo history.
- **System tray** — show/hide, always-on-top toggle, history viewer (`Ctrl+H`), save (`Ctrl+S`), and quit.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Windows (mouse-passthrough and edge-snapping are Windows-specific; other features work cross-platform)

### Run in development

```bash
git clone https://github.com/zett721/im-back
cd im-back
npm install
npm start
```

Or double-click `start.vbs` on Windows to launch without a terminal window.

### Build an installer (Windows)

```bash
npm run dist
```

The `.exe` installer will appear in the `dist/` folder.

> **Icon note:** For a custom installer icon, place an `icon.ico` alongside `icon.png` in the project root.  
> Convert with any tool (e.g. [cloudconvert.com](https://cloudconvert.com/png-to-ico)). If `icon.ico` is missing, the build still succeeds with the default icon.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | Add child task |
| `Ctrl+Shift+N` | Add sibling task |
| `Enter` | Rename focused node |
| `Ctrl+Enter` | **Complete** focused node (return to parent) |
| `Delete` | **Delete** focused node (return to parent) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` | Save session (resume on next launch) |
| `Ctrl+H` | Toggle history panel |
| `Esc` | Close input / history / translate |

---

## Project Structure

```
im-back/
├── main.js                  # Electron main process (window, tray, IPC)
├── preload.cjs              # Context-bridge: exposes safe APIs to renderer
├── src/
│   ├── main/
│   │   ├── app-controller.js   # Facade: serialises all operations via a Promise queue
│   │   ├── tree-state.js       # Core state machine (tree CRUD + undo/redo)
│   │   └── session-store.js    # Persistence (active.json, event log, snapshots)
│   └── renderer/
│       ├── index.html
│       ├── app.js              # All UI logic + Canvas graph rendering
│       └── styles.css
└── tests/
    └── run-tests.js
```

### Architecture overview

```
User input (keyboard / click)
        │
        ▼
renderer/app.js  ──IPC──►  AppController.enqueue()
                                    │
                                    ▼
                           TreeStateMachine       ← in-memory state + undo stack
                                    │
                                    ▼
                           SessionStore           ← event log + debounced active.json
```

Every mutating operation is:
1. Applied to the in-memory `TreeStateMachine` (instant).
2. Appended to a plain-text event log (audit trail).
3. Scheduled to flush to `active.json` after a 250 ms debounce (atomic write via temp-file rename).

---

## Data Storage

All data lives in the Electron `userData` directory (e.g. `%APPDATA%\im-back\sessions\` on Windows):

| File | Description |
|---|---|
| `active.json` | Current live session state |
| `continue.flag` | Presence of this file tells next launch to resume |
| `YYYY-MM-DD_HH-mm-ss.events.log` | Human-readable event log for each session |
| `YYYY-MM-DD_HH-mm-ss.snapshot.json` | Auto-archived snapshot of the previous session |

---

## Running Tests

```bash
npm test
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repo and create a feature branch.
2. Keep changes focused — one concern per PR.
3. Run `npm test` before submitting.
4. Open an issue first for larger changes so we can discuss the approach.

---

## License

[MIT](LICENSE)
