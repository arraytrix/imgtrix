export interface HistoryEntry {
  description: string
  layerId: string
  dirtyRect: { x: number; y: number; w: number; h: number }
  beforePixels: ArrayBuffer  // RGBA pixels covering dirtyRect (w × h × 4 bytes)
  afterPixels: ArrayBuffer   // RGBA pixels covering dirtyRect (w × h × 4 bytes)
  // Selection / offset fields added by specific operations
  selectionBefore?: import('./selection').Selection | null
  selectionAfter?:  import('./selection').Selection | null
  offsetBefore?: { x: number; y: number }
  offsetAfter?:  { x: number; y: number }
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

export class HistoryManager {
  onChanged?: () => void  // called after any push (used for dirty tracking)

  private stack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private memoryUsed = 0
  private readonly MEMORY_BUDGET = 512 * 1024 * 1024  // 512 MB

  get canUndo(): boolean { return this.stack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  push(entry: HistoryEntry): void {
    this.redoStack = []  // branching clears redo
    this.memoryUsed += entry.beforePixels.byteLength + entry.afterPixels.byteLength
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

  clear(): void {
    this.stack = []
    this.redoStack = []
    this.memoryUsed = 0
  }

  private evict(): void {
    while (this.memoryUsed > this.MEMORY_BUDGET && this.stack.length > 1) {
      const dropped = this.stack.shift()!
      this.memoryUsed -= dropped.beforePixels.byteLength + dropped.afterPixels.byteLength
    }
  }
}
