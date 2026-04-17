# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev          # Start with Vite HMR (renderer hot-reloads; electron/ changes require restart)
npm run build        # Build to out/
npm run dist:win     # Windows NSIS installer
npm run dist:mac     # macOS DMG
npm run dist:linux   # Linux AppImage + deb
```

## Architecture

**Imgtrix** is a desktop image editor built with Electron + Svelte + TypeScript. GPU-accelerated compositing, 14+ brush tools, non-destructive history, and multi-tab editing.

### Directory Layout

- `electron/` — Main process: `main.ts` (menus, IPC, file dialogs), `preload.ts` (IPC bridge via `window.api`), `settings-manager.ts`
- `src/` — Svelte renderer
  - `App.svelte` — Root component (~2400 lines): toolbar, tab bar, tool sidebar, all menu/keyboard handlers
  - `store.ts` — All Svelte stores: tabs, layerStack, historyManager, selection, viewport, clipboard
  - `settings-store.ts` — User preferences and hotkeys
  - `components/` — `CanvasView.svelte` (render loop), `LayerPanel.svelte`, `Tooltip.svelte`
  - `engine/` — Core editing engine (see below)
  - `constants/` — `hotkeys.ts`, `tool-meta.ts`, `settings_defaults.ts`, `ui-strings.ts`, `param-strings.ts`
  - `workers/` — Web Workers for background ops
- `resources/` — Icons, NSIS installer config

### State Management

**Tab-swapped stores** (saved/restored on tab switch): `layerStack`, `historyManager`, `selection`, `canvasSize`, `viewport`, `zoomPct`

**Global stores**: `tabs`, `activeTabIndex`, `clipboard`, `activeToolName`, `menuAction`

**Singletons** (never swapped): `compositor` (WebGL), `toolManager`

Tab helpers: `switchTab()`, `newTab()`, `closeTab()`, `openInNewTab()`, `markCurrentTabDirty()`, `markCurrentTabClean()`

### Engine

- **compositor.ts** / **webgl-compositor.ts** — CPU (Canvas2D) and GPU (WebGL) compositing. WebGL is 3–10x faster for multi-layer docs; textures cached per layer, re-uploaded only when `layer.gpuDirty = true`. Fragment shader handles all 12 blend modes in one pass.
- **layer.ts** / **layer-stack.ts** — Each layer owns an OffscreenCanvas. Layer index 0 = bottom. 12 blend modes. `gpuDirty` flag controls GPU texture invalidation.
- **history-manager.ts** — Undo/redo with dirty-rect snapshots. 512 MB budget per tab; only stores the affected rect (10–100x smaller than full canvas). Auto-evicts oldest entries.
- **tool-manager.ts** — Dispatches pointer events to the active tool, owns the stroke overlay canvas. Tools return a `HistoryEntry | null` from `onPointerUp`.
- **tools/** — 14 tools: Pencil, Eraser, Clone, Warp, Blend/Smudge, Saturation, Dodge/Burn, Rect Select, Lasso Select, Magic Wand, Eyedropper, Fill, Move Selection, Move Layer
- **brush-params.ts** — Shared pressure-sensitive dab drawing used by most paint tools
- **warp-webgl.ts** — GPU bilinear resampling for the warp tool
- **file-manager.ts** — `.img` format is a ZIP: `manifest.json`, `layers.json`, `layers/{id}.bin` (raw RGBA)

### Key Patterns

**Pointer flow:** `CanvasView` converts screen → document coords → `toolManager.handlePointer*` → `historyManager.push()` → `requestRender()`

**Render batching:** Multiple `requestRender()` calls in one frame are batched; the render loop lives in `CanvasView.svelte`.

**Adding a tool:** Create `src/engine/tools/my-tool.ts` implementing `{ onPointerDown, onPointerMove, onPointerUp, getCursor }` → register in `tool-manager.ts` → add to `tool-meta.ts` and `hotkeys.ts` → add UI button in `App.svelte`

**Menu actions:** Defined in `electron/main.ts` → arrive via `menuAction` store → handled in `App.svelte` → reset to `null` after handling. Native menu is rebuilt dynamically when selection/clipboard state changes.

**IPC bridge (`window.api`):** File dialogs, read/write file, menu event callbacks, settings load/save, `getOpenWithFile()` for launch-with-file support.

### Build Config

`electron.vite.config.ts` — three entry points bundled separately: main (`out/main/`), preload (`out/preload/`), renderer (`out/renderer/`). Three tsconfig files: root, `tsconfig.node.json` (main/preload), `tsconfig.web.json` (renderer).
