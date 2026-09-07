import { HISTORY_BUDGET_DEFAULT_MB, clampHistoryBudgetMB } from '../constants/settings_defaults'

/** Pixel and/or placement change to one layer. */
export interface LayerPatch {
  layerId: string
  dirtyRect?: { x: number; y: number; w: number; h: number }
  beforePixels?: ArrayBuffer
  afterPixels?:  ArrayBuffer
  offsetBefore?: { x: number; y: number }
  offsetAfter?:  { x: number; y: number }
}

/** Whole-buffer snapshot of one layer, for ops that change canvas geometry. */
export interface LayerSnapshot {
  layerId: string
  width: number
  height: number
  offsetX: number
  offsetY: number
  pixels: ArrayBuffer        // full layer, RGBA (width × height × 4 bytes)
}

/**
 * A crop: every layer is re-cut to `rect` and the document shrinks with it.
 * Undo restores the layers from `layersBefore`; redo just re-runs the crop,
 * which is deterministic from that exact state, so the cropped pixels are
 * never stored twice.
 */
export interface CropChange {
  rect: { x: number; y: number; w: number; h: number }
  widthBefore: number
  heightBefore: number
  layersBefore: LayerSnapshot[]
}

export interface HistoryEntry {
  description: string
  // A pixel/placement patch to one layer. Absent on entries that change the
  // document another way (see `crop`).
  layerId?: string
  dirtyRect?: { x: number; y: number; w: number; h: number }
  beforePixels?: ArrayBuffer  // RGBA pixels covering dirtyRect (w × h × 4 bytes)
  afterPixels?: ArrayBuffer   // RGBA pixels covering dirtyRect (w × h × 4 bytes)
  // Selection / offset fields added by specific operations
  selectionBefore?: import('./selection').Selection | null
  selectionAfter?:  import('./selection').Selection | null
  offsetBefore?: { x: number; y: number }
  offsetAfter?:  { x: number; y: number }
  /**
   * Further layers changed by the same operation, undone/redone together with
   * it — used by Move Selection, which punches a hole in the source layer and
   * fills a float layer in one step, and by the Adjust operations, which
   * rewrite every layer at once.
   */
  extras?: LayerPatch[]
  /** Canvas-geometry change; applied instead of a per-layer patch. */
  crop?: CropChange
}

/**
 * Extract a sub-rectangle from a full-layer ImageData.
 * Returns an ArrayBuffer containing only the (x, y, w, h) region.
 */
export function extractRect(src: ImageData, x: number, y: number, w: number, h: number): ArrayBuffer {
  if (w <= 0 || h <= 0) return new ArrayBuffer(0)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * src.width + x) * 4
    out.set(src.data.subarray(s, s + w * 4), row * w * 4)
  }
  return out.buffer
}

const MB = 1024 * 1024

// One ceiling shared by every tab's history (each tab gets this much on its
// own — it is not divided between them). Configurable in Settings → History
// Memory; see settings-store, which pushes the user's value in here.
let budgetBytes = HISTORY_BUDGET_DEFAULT_MB * MB

export function setHistoryBudgetMB(mb: number): void {
  budgetBytes = clampHistoryBudgetMB(mb) * MB
}

export class HistoryManager {
  onChanged?: () => void  // called after any push (used for dirty tracking)

  private stack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private memoryUsed = 0

  get canUndo(): boolean { return this.stack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  /** Bytes currently held by undoable steps — shown in the settings dialog. */
  get bytesUsed(): number { return this.memoryUsed }
  get stepCount(): number { return this.stack.length }

  /** Bytes an entry holds, counting every layer it touches. */
  private static sizeOf(entry: HistoryEntry): number {
    let bytes = (entry.beforePixels?.byteLength ?? 0) + (entry.afterPixels?.byteLength ?? 0)
    for (const x of entry.extras ?? []) {
      bytes += (x.beforePixels?.byteLength ?? 0) + (x.afterPixels?.byteLength ?? 0)
    }
    for (const snap of entry.crop?.layersBefore ?? []) {
      bytes += snap.pixels.byteLength
    }
    return bytes
  }

  push(entry: HistoryEntry): void {
    // Branching clears redo — give back what those entries were accounted for,
    // or the running total drifts upward and evicts real history too early.
    for (const dropped of this.redoStack) this.memoryUsed -= HistoryManager.sizeOf(dropped)
    this.redoStack = []
    this.memoryUsed += HistoryManager.sizeOf(entry)
    this.stack.push(entry)
    this.evict()
    this.onChanged?.()
  }

  undo(applyFn: (entry: HistoryEntry) => void): boolean {
    const entry = this.stack.pop()
    if (!entry) return false
    this.redoStack.push(entry)
    applyFn(entry)
    return true
  }

  redo(applyFn: (entry: HistoryEntry) => void): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    this.stack.push(entry)
    applyFn(entry)
    return true
  }

  /** Drop oldest steps until back inside the budget (e.g. after lowering it). */
  trim(): void {
    this.evict()
  }

  clear(): void {
    this.stack = []
    this.redoStack = []
    this.memoryUsed = 0
  }

  private evict(): void {
    while (this.memoryUsed > budgetBytes && this.stack.length > 1) {
      const dropped = this.stack.shift()!
      this.memoryUsed -= HistoryManager.sizeOf(dropped)
    }
  }
}
