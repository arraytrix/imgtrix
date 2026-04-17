# Imgtrix PRD V2 — Performance & Architecture

## Overview

This document covers the next phase of Imgtrix development, focused on performance. The app currently runs 100% on the CPU using Canvas2D — every brush stroke, composite operation, and pixel filter is blocked on the main thread. The goal is to systematically identify the highest-cost operations and move them to faster execution paths: WebGL for parallelizable GPU work, and Web Workers for expensive CPU tasks that can be offloaded.

---

## Current Architecture Summary

| Component | Implementation | Bottleneck |
|---|---|---|
| Layer compositing | Canvas2D drawImage per layer | Slow for 5+ layers, blocks render |
| Brush dabs (pencil, eraser) | Canvas2D fillPath + radialGradient | Acceptable; gradient creation is redundant |
| Warp tool | CPU bilinear resampling, full canvas | O(affected_area × 4), very slow on large brushes |
| Clone tool | 2 new OffscreenCanvas allocations **per dab** | GC pressure, extremely slow |
| Blend / Smudge | getImageData + per-pixel falloff loop + putImageData per dab | O(r²) blocking the main thread |
| Dodge / Burn, Saturation | Same pattern as Blend | O(r²) blocking |
| Magic Wand | Full canvas composite → getImageData → BFS with sqrt() per neighbor | Full canvas allocation on every click |
| Undo history | Full layer getImageData × 2 per stroke (before + after) | Slow commit, high memory (~4 bytes × W × H × 2 per entry) |
| All rendering | Synchronous, main thread | UI freezes during expensive ops |

---

## Proposed Changes — Tiered by ROI

### Tier 1 — High ROI, Lower Complexity

These can be done independently and will have immediate visible impact.

---

#### 1.1 — WebGL Compositor

**Files:** `src/engine/compositor.ts` (already has a TODO comment for this)

The compositor is called every frame (on every requestRender). With 5+ large layers, each drawImage is a CPU-side pixel copy. A WebGL compositor uploads each layer as a GPU texture and composites them in a single shader pass.

**What changes:**
- Create a `WebGLCompositor` class alongside the existing `Compositor`
- Each layer's OffscreenCanvas is uploaded as a `WebGLTexture` and cached (re-uploaded only on dirty)
- A fragment shader handles blend modes (multiply, screen, overlay, etc.) natively
- Viewport transform (pan, zoom, checkerboard) runs on GPU
- The strokeCanvas overlay is handled as an additional texture pass

**Blend mode implementation:** WebGL fragment shaders for all current blend modes are well-documented. The Porter-Duff compositing model maps directly to GLSL.

**Expected gain:** 3–10× faster frame rendering for multi-layer documents. The improvement scales with layer count and canvas size.

**Risk:** Low. The compositor is a self-contained module. The existing CPU compositor stays as a fallback.

---

#### 1.2 — Dirty Rect History (already tracked, not yet used)

**Files:** `src/engine/history-manager.ts`, `src/engine/tool-manager.ts`

History currently stores the full `getImageData(0, 0, W, H)` for every layer before and after every stroke — even if the stroke only touched a 50×50 area. The dirty rect is already recorded in `HistoryEntry` but ignored during snapshot.

**What changes:**
- `takeSnapshot()` uses `getImageData(dirtyRect.x, dirtyRect.y, dirtyRect.w, dirtyRect.h)` instead of full canvas
- Restore reads the dirty rect and uses `putImageData()` with an offset
- Memory per entry drops from `4 × W × H` bytes to `4 × dirtyW × dirtyH` bytes
- For typical brush strokes this is 10–100× smaller

**Expected gain:** 10–100× memory reduction per history entry. Also faster stroke commit (smaller buffer to copy). History can now hold far more steps within the 512 MB budget.

**Risk:** Low. The dirty rect is already being computed. The change is isolated to history snapshot/restore logic.

---

#### 1.3 — Clone Tool: Eliminate Per-Dab Canvas Allocation

**Files:** `src/engine/tools/clone.ts`

The clone tool currently creates 2 new `OffscreenCanvas` objects per dab — one for the sampled region, one for the hardness mask. At 60+ dabs/sec this is severe GC pressure.

**What changes:**
- Allocate a single pair of reusable `OffscreenCanvas` buffers on stroke start (sized to max brush size)
- Reuse them across all dabs in the stroke
- Use `ctx.clearRect()` to reset between dabs rather than reallocating

**Expected gain:** Significantly smoother clone strokes. Eliminates GC pauses mid-stroke.

**Risk:** Very low. Self-contained change in one file.

---

#### 1.4 — Squared Distance in Inner Loops

**Files:** `blend.ts`, `dodge-burn.ts`, `saturation.ts`, `warp.ts`

Every per-pixel tool computes `Math.sqrt(dx² + dy²)` for every pixel in the brush radius, inside a tight loop. For a 200px brush this is ~125,000 sqrt() calls per dab.

**What changes:**
- Replace `dist < radius` with `distSq < radiusSq` (compare squared distances)
- Only compute `sqrt()` when the falloff gradient value is needed (once per ring, not per pixel)
- Precompute the falloff curve as a lookup table at stroke start

**Expected gain:** 15–30% speedup on all per-pixel brush tools at essentially zero cost.

**Risk:** None.

---

### Tier 2 — High ROI, Moderate Complexity

---

#### 2.1 — WebGL Warp Tool

**Files:** `src/engine/tools/warp.ts`

The warp tool is the single most expensive operation in the app. The `reapply()` function does bilinear texture sampling — this is exactly what GPUs do natively in hardware. Currently the CPU is doing it in a nested JS loop.

**What changes:**
- Create a WebGL context paired to a scratch canvas
- Upload the layer snapshot as a texture
- The displacement maps (already Float32Arrays) are uploaded as a two-channel floating-point texture
- A fragment shader performs the bilinear sample: `texture2D(snapshot, uv + displacement)`
- Read the result back via `readPixels()` and `putImageData()` into the layer
- The displacement maps are still maintained on the CPU (the math to update them is fast)

**Why this is viable:** The bilinear sampling is a pure texture lookup operation — it's the literal definition of a GPU fragment shader. The only overhead is the readback (`readPixels`), which is unavoidable since the result needs to go back into the layer's OffscreenCanvas. For large brush sizes this will still be faster than per-pixel JS loops.

**Expected gain:** 5–20× faster warp at large brush sizes. Warp becomes interactive at canvas sizes where it currently stutters.

**Risk:** Medium. WebGL texture readback (`readPixels`) has latency that must be managed. Recommend testing on large canvases to confirm the break-even point vs. the current CPU approach.

---

#### 2.2 — Web Worker for Magic Wand BFS

**Files:** `src/engine/tools/magic-wand.ts`

Magic wand currently: composites all layers → full canvas `getImageData` → BFS flood fill with `sqrt()` distance per neighbor. All of this blocks the main thread.

**What changes:**
- Move the BFS algorithm into a Web Worker
- Transfer the composited canvas pixel data to the worker as a `Transferable` (zero-copy)
- Worker returns the tight-bbox mask buffer
- Main thread applies the selection on receipt

**Note on compositing:** The composite step should ideally be the WebGL compositor output (from 1.1), making this even faster since the GPU composite result can be read back once and transferred.

**Expected gain:** Main thread no longer freezes on large canvas magic wand clicks. BFS can also use squared distance (no sqrt) for a further speedup.

**Risk:** Medium. Worker communication adds latency (~1–5ms for transfer). Selection won't be instant but the UI won't freeze. A loading cursor can cover the latency.

---

#### 2.3 — Web Worker for Per-Pixel Brush Tools

**Files:** `blend.ts`, `dodge-burn.ts`, `saturation.ts`

These tools all do the same pattern: `getImageData` → per-pixel loop → `putImageData`. The loop can be moved to a worker.

**What changes:**
- Create a shared `PixelWorker` that accepts a pixel buffer + operation type + params
- Main thread sends the region buffer as a Transferable (zero-copy)
- Worker applies the operation and returns the modified buffer
- Main thread writes it back via `putImageData`

**Challenge:** The per-dab latency (main ↔ worker round trip) needs to be measured. At brush sizes above ~150px the worker will be faster. Below that the transfer overhead may dominate. A threshold-based fallback (CPU for small brushes, worker for large) is reasonable.

**Expected gain:** No main thread jank on large brush strokes. Blend tool in particular becomes much smoother.

**Risk:** Medium. Requires careful latency measurement. The worker needs to stay warm (pre-allocated) to avoid startup cost per dab.

---

### Tier 3 — Lower Priority / Future

These are valid optimizations but have higher complexity or lower visible impact compared to the tiers above.

---

#### 3.1 — WebGL Per-Pixel Brush Effects

Rather than workers (Tier 2.3), dodge/burn and saturation could run as WebGL fragment shaders — upload region as texture, apply shader, read back. Faster than workers for large regions but adds GPU dependency for brush tools.

**Recommended only after** the WebGL compositor (1.1) and warp WebGL (2.1) are proven stable, since it reuses the same WebGL infrastructure.

---

#### 3.2 — Lazy Canvas Allocation

Currently every layer allocates `OffscreenCanvas(fullWidth, fullHeight)` regardless of content. Layers with sparse content (a single stamp, a small element) waste significant memory.

This requires a non-trivial refactor of the layer/compositor model (virtual canvas coordinates). Recommend deferring until after the GPU compositor is in place.

---

#### 3.3 — Tiled Rendering

For very large canvases (4K+), tiling the canvas into 512×512 chunks allows partial invalidation and render. This is a significant architectural change and should only be considered if the above optimizations are insufficient.

---

## Recommended Implementation Order

```
Phase 1 (Quick wins, low risk)
  └─ 1.2  Dirty Rect History
  └─ 1.3  Clone Tool buffer reuse
  └─ 1.4  Squared distance in brush loops

Phase 2 (GPU compositor — self-contained, high payoff)
  └─ 1.1  WebGL Compositor
           (fallback to Canvas2D if WebGL unavailable)

Phase 3 (WebGL tools)
  └─ 2.1  WebGL Warp Tool
           (reuses WebGL infrastructure from Phase 2)

Phase 4 (Worker offload)
  └─ 2.2  Magic Wand BFS worker
  └─ 2.3  Per-pixel brush worker (blend, dodge/burn, saturation)

Phase 5 (If needed)
  └─ 3.1  WebGL per-pixel brushes (replaces 2.3 workers)
  └─ 3.2  Lazy canvas allocation
  └─ 3.3  Tiled rendering
```

---

## WebGL Feasibility Notes

WebGL is a first-class citizen in Electron's Chromium renderer. There are no restrictions or special flags needed. The main practical considerations:

- **Texture upload cost**: `OffscreenCanvas` → `WebGLTexture` requires a `texImage2D` call. This is fast (~1ms for a 2000×2000 layer) but should be cached with a dirty flag per layer.
- **Readback cost**: `readPixels` is the expensive half of GPU work (GPU → CPU stall). For the compositor this is not needed (the result stays on screen). For warp tool it is required and must be benchmarked.
- **Context limit**: Browsers allow ~16 simultaneous WebGL contexts. One shared context for the compositor + tool shaders is plenty.
- **Blend mode shaders**: GLSL implementations of Photoshop blend modes are well-established. The `KHR_blend_equation_advanced` extension covers many of them natively; for the rest, per-pixel fragment shaders are straightforward.

---

## Open Questions

1. **Readback threshold for warp:** At what canvas size does WebGL bilinear + readback beat CPU? Needs profiling at 1080p and 4K.
2. **Worker latency budget:** Is a 5–10ms selection delay acceptable for magic wand, or should there be a visual indicator?
3. **WebGL context sharing:** Should the compositor and tool shaders share one context, or use separate contexts per responsibility? Separate is cleaner but uses more resources.
4. **Blend mode parity:** Need to audit all current Canvas2D blend modes against WebGL shader equivalents to ensure visual parity before switching the compositor.
