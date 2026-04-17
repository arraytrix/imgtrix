# imgtrix

A desktop image editor built with Electron and Svelte. Designed as a solid foundation for advanced image editing features — multi-layer canvas editing, a growing brush toolset, non-destructive history, and a native application experience.

---

## Features

- **Multi-tab editing** — Work on multiple images simultaneously, each with independent layers, history, and viewport state
- **Layer system** — Add, remove, reorder, and toggle visibility of layers with blend mode and opacity support
- **Brush tools** — Pencil, Eraser, Clone Stamp, Warp, Blend/Smudge, Saturation, and Dodge/Burn
- **Selection tools** — Rectangular and freehand (lasso) selection with marching ants preview
- **Edit operations** — Copy, cut, paste (to new layer), select all, clear selection
- **Selection to new image** — Extract a selection into its own tab, sized to the selection bounds
- **Undo / Redo** — Full per-tab history with pixel-level before/after snapshots
- **File support** — Native `.img` project format (ZIP-based, preserves all layers), plus PNG / JPEG / WebP import and export
- **Import options** — Import as a new layer on the current canvas, or import as a new tab sized to the image
- **Canvas operations** — Resize canvas, rotate 90° / 180°
- **Dirty state tracking** — Unsaved-changes indicator per tab, with save prompts on close

---

## Architecture

```
imgtrix/
├── electron/
│   ├── main.ts          # Main process: window creation, native menus, IPC handlers, file dialogs
│   └── preload.ts       # Preload bridge: exposes window.api.* to the renderer safely
│
├── src/
│   ├── App.svelte        # Root component: toolbar, tab bar, tool sidebar, all menu action handlers
│   ├── store.ts          # Svelte stores: tab state, active tool, selection, clipboard, history
│   │
│   ├── components/
│   │   ├── CanvasView.svelte   # Canvas rendering loop, pointer event handling, undo/redo application
│   │   ├── LayerPanel.svelte   # Layer list UI: add/remove/reorder/visibility/opacity/blend mode
│   │   └── Tooltip.svelte      # Floating tooltip component used in the toolbar
│   │
│   └── engine/
│       ├── compositor.ts       # Composites layer stack onto a visible <canvas> using viewport transform
│       ├── history-manager.ts  # Undo/redo stack with before/after pixel snapshots per entry
│       ├── layer.ts            # Layer class wrapping an OffscreenCanvas
│       ├── layer-stack.ts      # Ordered collection of layers with active index, resize, rotate
│       ├── file-manager.ts     # Save/open .img projects (JSZip), import/export images
│       ├── selection.ts        # Selection type definitions (rect | lasso)
│       ├── tool-manager.ts     # Dispatches pointer events to the active tool, owns stroke overlay canvas
│       └── tools/
│           ├── tool.ts         # Tool interface and HistoryEntry type
│           ├── pencil.ts       # Pressure-sensitive paint brush
│           ├── eraser.ts       # Eraser brush
│           ├── clone.ts        # Clone stamp with optional trace mode
│           ├── warp.ts         # Liquify-style warp (push, twirl, bloat, pucker, reconstruct)
│           ├── blend.ts        # Smudge/blend brush
│           ├── saturation.ts   # Saturate / desaturate brush
│           ├── dodge-burn.ts   # Dodge (lighten) / burn (darken) brush
│           ├── rect-select.ts  # Rectangular marquee selection
│           └── lasso-select.ts # Freehand lasso selection
```

### Key design decisions

**Electron + Svelte via electron-vite** — The main process handles native concerns (menus, file dialogs, window lifecycle). The renderer is a standard Svelte SPA communicating with main exclusively through the `window.api` preload bridge.

**OffscreenCanvas per layer** — Each layer owns an `OffscreenCanvas`. Tools read and write pixel data directly via `getImageData` / `putImageData`. The compositor draws all visible layers onto the display canvas each frame using the current viewport transform (pan + zoom).

**Store-swapped tab state** — Tab switching works by saving the current tab's state (viewport, selection, zoom) back into the tab object, then loading the new tab's `LayerStack` and `HistoryManager` into the shared Svelte stores. Components subscribe to the stores and automatically reflect whichever tab is active.

**History via pixel snapshots** — Each `HistoryEntry` stores the full before and after pixel buffers for the affected layer's dirty rect. Undo/redo restores pixels directly via `putImageData`. This is simple and reliable at the cost of memory for large canvases.

**Dynamic native menu** — Menu items that depend on application state (Copy, Cut, Paste, Clear Selection, Move Selection to New Image) are enabled/disabled by rebuilding the Electron menu via `Menu.setApplicationMenu`. The renderer notifies the main process of selection and clipboard state changes over IPC.

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v9 or later

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

This starts the Electron app with Vite's HMR dev server. Changes to `src/` (Svelte/TS renderer code) hot-reload instantly. Changes to `electron/` (main process) require an app restart.

### Build for production

```bash
npm run build
```

Output is written to `out/`. The app can be previewed from the build with:

```bash
npm run preview
```

### Project file format (`.img`)

The native project format is a ZIP archive containing:
- `manifest.json` — canvas dimensions and metadata
- `layers.json` — layer metadata (name, blend mode, opacity, visibility)
- `layers/<id>.bin` — raw RGBA pixel data for each layer

This format is handled entirely by `src/engine/file-manager.ts`.
