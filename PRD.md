# Product Requirements Document — Image Editor

## Overview

A desktop image editing application in the Photoshop-lite category. Core focus is layer-based raster editing with high-quality brush tooling, including advanced clone brush variants and a warp brush. Built for a single-user desktop environment with an emphasis on performance and a clean, modern UI.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Shell | Electron | Cross-platform distribution, full file system access |
| UI | Svelte + TypeScript | Lightweight reactivity, minimal overhead in renderer process |
| Build | Vite + electron-vite | Fast HMR, first-class Svelte + Electron support |
| Rendering | Canvas 2D API | Direct pixel buffer access, no external dependency |
| Heavy compute | Web Workers | Keeps main thread free during brush/warp operations |
| ZIP I/O | jszip | Simple API, works in browser context |

### Planned Optimizations (not v1)
- WebGL compositor for layer blending — highest priority GPU upgrade
- WebGL fragment shader for warp displacement map rendering
- SharedArrayBuffer upgrade for clone/warp workers to eliminate transfer latency

---

## Features

### Layers
- Add, delete, rename, reorder layers
- Per-layer: opacity, blend mode, visibility toggle
- Layer panel in Svelte UI reflecting live layer stack state

### Tools
- Pencil (hard brush)
- Soft brush (opacity + hardness controls)
- Eraser
- Clone brush (see below)
- Warp brush (see below)

### Clone Brush
The primary differentiating feature. Samples pixels from a source region and paints them to a destination region with configurable brush falloff and opacity. Planned variants:
- Standard clone
- Healing (blends texture while matching surrounding tone/color)
- Pattern clone
- Perspective clone

### Warp Brush
Displaces pixels within a brush radius using a displacement field. Modes:
- Push (displaces in direction of stroke)
- Twirl (rotates pixels around brush center)
- Bloat (expands pixels outward from center)
- Pucker (contracts pixels toward center)
- Reconstruct (moves displacement back toward zero)

### History / Undo
- Unlimited undo/redo steps within a configurable memory budget (default 512MB)
- Oldest entries dropped when budget is exceeded
- Redo stack cleared on new action (standard branching behavior)

### File Operations
- Open/save native project format (.img)
- Export: PNG, JPG, WebP
- Import flat image (PNG, JPG, WebP) as a new layer
- Autosave to temp file; recovery offered on next launch after unclean exit

---

## Architecture

### Process Model

```
Electron Main Process
└── Renderer Process
    ├── Svelte UI (layer panel, toolbox, settings)
    ├── Canvas Engine
    │   ├── LayerStack
    │   ├── ToolManager
    │   ├── Compositor
    │   └── HistoryManager
    └── Web Workers
        ├── BrushWorker
        ├── CloneWorker
        ├── WarpWorker
        └── FileWorker
```

File system access (dialogs, read, write) is handled exclusively in the main process. The renderer communicates with it via IPC, passing `ArrayBuffer` as transferable objects.

---

### Rendering Pipeline

Each layer is backed by an `OffscreenCanvas`. The active tool maintains a separate `strokeCanvas` for in-progress operations. On every `requestAnimationFrame` the compositor merges:

```
layers below active + (activeLayer + strokeCanvas) + layers above → display canvas
```

**Compositor — v1:** CPU composite on the main thread using `drawImage`. Adequate for canvases up to approximately 2000×2000px.

**Compositor — planned:** WebGL pass compositing layer textures with full blend mode support. Swap-in without touching the rest of the architecture.

The compositor is a **swappable module** by design so the upgrade path does not require refactoring the layer model or tool system.

---

### Tool System

Tools follow a Strategy pattern. Each tool implements:

```typescript
interface Tool {
  onPointerDown(event: ToolEvent, context: ToolContext): void
  onPointerMove(event: ToolEvent, context: ToolContext): void
  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry
  getCursor(): string
}

interface ToolContext {
  activeLayer: Layer
  strokeCanvas: OffscreenCanvas
  strokeMask: Float32Array      // SharedArrayBuffer-backed
  requestRender(): void
}
```

`onPointerUp` returns a `HistoryEntry`. The `ToolManager` receives it and passes it to `HistoryManager`. Tools own the responsibility of knowing their dirty rect and capturing before/after pixel snapshots.

#### Stroke Accumulation and Opacity

To prevent opacity accumulation artifacts when dabs overlap during a single stroke, each tool maintains a `strokeMask` (`Float32Array`, one value per pixel). On each dab:

```
strokeMask[pixel] = max(strokeMask[pixel], dabOpacity × falloff)
```

The rendered result is:
```
output = lerp(originalLayer, brushColor, strokeMask)
```

The stroke mask is cleared on pointer up after the commit. This applies to all brush-type tools.

---

### Worker Architecture

Heavy pixel operations run in Web Workers to keep the main thread free for UI and pointer event handling.

#### BrushWorker

Handles pencil, eraser, soft brush. Uses transferable `ArrayBuffer` for pixel data.

```typescript
// Main → Worker
type BrushDabMessage = {
  type: 'brush_dab'
  x: number
  y: number
  radius: number
  hardness: number        // 0–1, controls falloff curve
  opacity: number
  color: [number, number, number, number]
  destBuffer: ArrayBuffer // transferable
}

// Worker → Main
type DabResult = {
  type: 'dab_result'
  buffer: ArrayBuffer
  rect: { x: number, y: number, w: number, h: number }
}
```

#### CloneWorker

Reads from a source region and blends into a destination region. Uses `SharedArrayBuffer` for both source and destination to avoid transfer latency on rapid dab sequences.

```typescript
type CloneDabMessage = {
  type: 'clone_dab'
  x: number
  y: number
  radius: number
  hardness: number
  opacity: number
  sourceOffset: { x: number, y: number }
  sourceBuffer: SharedArrayBuffer
  destBuffer: SharedArrayBuffer
}
```

#### WarpWorker

Maintains a displacement field (`dispX`, `dispY` as `Float32Array` over `SharedArrayBuffer`). On each dab, updates the displacement field in the brush radius, then applies the full displacement map to the original snapshot to produce output.

```typescript
// Sent once at stroke start
type WarpInitMessage = {
  type: 'warp_init'
  snapshotBuffer: SharedArrayBuffer  // original pixels, read-only for duration of stroke
  dispX: SharedArrayBuffer
  dispY: SharedArrayBuffer
  width: number
  height: number
}

// Sent on each pointer move
type WarpDabMessage = {
  type: 'warp_dab'
  x: number
  y: number
  radius: number
  hardness: number
  strength: number
  mode: 'push' | 'twirl' | 'bloat' | 'pucker' | 'reconstruct'
  directionX: number
  directionY: number
}

// Worker → Main
type WarpResult = {
  type: 'warp_result'
  buffer: ArrayBuffer
  rect: { x: number, y: number, w: number, h: number }
}
```

**Warp dirty rect:** displacement spreads visual change beyond the brush radius. At v1, snapshot the full layer at warp stroke start. Optimize to region-based dirty tracking later.

**Warp GPU path (planned):** displacement map application is a textbook fragment shader operation and is the single highest-value GPU optimization in the codebase.

#### FileWorker

Handles ZIP encode/decode for project files. Keeps main thread free during save/load of large projects.

---

### History Model

```typescript
interface HistoryEntry {
  description: string
  layerId: string
  dirtyRect: Rect
  beforePixels: ArrayBuffer
  afterPixels: ArrayBuffer
}

// Layer structural operations (no pixel data)
type LayerHistoryEntry =
  | { type: 'layer_add',     layerId: string, layerData: LayerSnapshot, index: number }
  | { type: 'layer_delete',  layerId: string, layerData: LayerSnapshot, index: number }
  | { type: 'layer_reorder', layerId: string, fromIndex: number, toIndex: number }
  | { type: 'layer_merge',   changes: PixelChange[] }
```

**Granularity:** one history entry per stroke (pointer down → pointer up), not per dab.

**Memory management:**

```typescript
class HistoryManager {
  private stack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private memoryUsed = 0
  private readonly MEMORY_BUDGET = 512 * 1024 * 1024  // 512MB, configurable

  push(entry: HistoryEntry) {
    this.redoStack = []
    this.memoryUsed += entry.beforePixels.byteLength + entry.afterPixels.byteLength
    this.stack.push(entry)
    while (this.memoryUsed > this.MEMORY_BUDGET) {
      const dropped = this.stack.shift()!
      this.memoryUsed -= dropped.beforePixels.byteLength + dropped.afterPixels.byteLength
    }
  }
}
```

Filters dirty the entire affected layer — no optimization possible. All other operations use the actual stroke bounding box.

---

### File Format

#### Native Format (.img)

A ZIP archive with the following structure:

```
project.img
├── manifest.json       { version, canvasWidth, canvasHeight, created, modified }
├── layers.json         [ { id, name, blendMode, opacity, visible, x, y, width, height } ]
└── layers/
    └── {layerId}.bin   raw RGBA pixel data (width × height × 4 bytes, uncompressed)
```

Layer pixel data is stored as raw binary (not PNG) to avoid per-layer encode/decode cost. ZIP-level compression handles redundancy.

#### Export Formats

| Format | API |
|---|---|
| PNG | `OffscreenCanvas.convertToBlob({ type: 'image/png' })` |
| JPG | `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality })` |
| WebP | `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality })` |

Export flattens all visible layers to a single canvas before encoding.

#### Import

Flat images (PNG, JPG, WebP) are imported as a new layer via `createImageBitmap`, drawn onto a new `OffscreenCanvas` sized to the image, and inserted at the top of the layer stack.

#### IPC Pattern

```
Renderer → ipc: 'file:open-dialog'     → Main → dialog.showOpenDialog()
Renderer → ipc: 'file:read', path      → Main → fs.readFile() → ArrayBuffer
Renderer → ipc: 'file:write', path     → Main → fs.writeFile(ArrayBuffer)
Renderer → ipc: 'file:save-dialog'     → Main → dialog.showSaveDialog()
```

Main process is intentionally thin — bytes in, bytes out. All encode/decode happens in the renderer's FileWorker.

#### Autosave

- Writes a recovery file to `app.getPath('userData')/recovery.img` every 5 minutes and after every 20 committed history entries
- On launch, checks for a recovery file and offers to restore it
- Recovery file is deleted on clean project save

---

## Development Phases

### Phase 1 — Walking Skeleton
Goal: prove the full architecture works end to end before building features.

- Electron window with a single canvas
- One layer, pencil tool (proves pixel write + BrushWorker)
- Layer panel in Svelte (add/delete/reorder, proves state model)
- Undo/redo with command pattern (hardest to retrofit)
- Export to PNG

### Phase 2 — Core Brush Tooling
- Soft brush with hardness + opacity
- Stroke mask for correct opacity accumulation
- Eraser
- History polish (memory budget, entry descriptions)

### Phase 3 — Clone Brush
- Standard clone brush via CloneWorker
- Source point indicator UI
- Healing variant

### Phase 4 — Warp Brush
- WarpWorker with push + twirl modes
- Reconstruct mode
- Remaining modes (bloat, pucker)

### Phase 5 — Polish and Advanced Features
- Remaining clone variants (pattern, perspective)
- Full blend mode support
- Filters (brightness/contrast, hue/saturation, blur)
- WebGL compositor
- WebGL warp shader
- Autosave + recovery
