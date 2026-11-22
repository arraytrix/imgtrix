import type { Layer } from './layer'
import type { HistoryEntry, LayerPatch } from './history-manager'

export type AdjustmentTransform = (pixels: Uint8ClampedArray) => void

/** Temporary buffers keep preview pixels out of the document's saved history. */
export class AdjustmentPreview {
  private snapshots: {
    layer: Layer
    canvas: OffscreenCanvas
    ctx: OffscreenCanvasRenderingContext2D
    original: ImageData
    working: ImageData
    previewCanvas: OffscreenCanvas
    previewCtx: OffscreenCanvasRenderingContext2D
  }[]

  constructor(layers: Layer[]) {
    this.snapshots = layers.filter(layer => layer.canvas.width && layer.canvas.height).map(layer => {
      const { width, height } = layer.canvas
      const previewCanvas = new OffscreenCanvas(width, height)
      const previewCtx = previewCanvas.getContext('2d')!
      return {
        layer, canvas: layer.canvas, ctx: layer.ctx,
        original: layer.getImageData(),
        working: previewCtx.createImageData(width, height),
        previewCanvas, previewCtx,
      }
    })
  }

  update(transform: AdjustmentTransform | null): void {
    for (const snap of this.snapshots) {
      if (transform) {
        // Always start from the original, never from the previous preview.
        snap.working.data.set(snap.original.data)
        transform(snap.working.data)
        snap.previewCtx.putImageData(snap.working, 0, 0)
        snap.layer.canvas = snap.previewCanvas
        snap.layer.ctx = snap.previewCtx
      } else {
        snap.layer.canvas = snap.canvas
        snap.layer.ctx = snap.ctx
      }
      snap.layer.gpuDirty = true
    }
  }

  cancel(): void {
    this.update(null)
    this.snapshots = []
  }

  /** Commit only changed layers, as one undo step; neutral settings are a no-op. */
  commit(description: string): HistoryEntry | null {
    const patches: LayerPatch[] = []
    for (const snap of this.snapshots) {
      const after = snap.layer.getImageData()
      if (after.data.some((value, i) => value !== snap.original.data[i])) {
        patches.push({
          layerId: snap.layer.id,
          dirtyRect: { x: 0, y: 0, w: after.width, h: after.height },
          beforePixels: snap.original.data.slice().buffer,
          afterPixels: after.data.slice().buffer,
        })
        snap.layer.markDirty()
      } else {
        snap.layer.canvas = snap.canvas
        snap.layer.ctx = snap.ctx
        snap.layer.gpuDirty = true
      }
    }
    this.snapshots = []
    if (!patches.length) return null
    const [main, ...extras] = patches
    return { description, ...main, extras }
  }
}
