import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'
import { drawBrushDab, dabRadius, strokeOpacity, toLayerRect, type BrushParams } from './brush-params'

/**
 * Eraser.
 *
 * The stroke is accumulated as a coverage mask and subtracted from the layer as
 * a single operation, the same way the paintbrush stages on the stroke canvas
 * before compositing. Punching each dab straight into the layer instead — which
 * is what this used to do — compounds: `destination-out` is multiplicative, so
 * every overlapping dab removes a further fraction of what's left. Dabs are
 * spaced a quarter of a brush *diameter* apart, so the feathered rim of a soft
 * edge gets hit a different number of times depending on how fast the cursor
 * moved, leaving scalloped, blotchy edges. It also made the opacity setting a
 * no-op at the default flow of 0.
 */
export class EraserTool implements Tool {
  size      = 20
  opacity   = 1
  hardness  = 0.8
  softness  = 0
  rotation  = 0
  thickness = 1
  flow     = 0

  private get params(): BrushParams {
    return {
      size: this.size,
      opacity: this.opacity,
      hardness: this.hardness,
      softness: this.softness,
      rotation: this.rotation,
      thickness: this.thickness,
      flow: this.flow,
    }
  }

  private beforeSnapshot: ImageData | null = null
  /**
   * Coverage mask for the stroke in progress, in document space. Private rather
   * than the shared stroke canvas, which the compositor paints on screen — an
   * opaque mask there would show up as a black stroke while erasing.
   */
  private mask: OffscreenCanvas | null = null
  private maskCtx: OffscreenCanvasRenderingContext2D | null = null

  // Accumulated document-space bounds of the stroke
  private dx0 = Infinity; private dy0 = Infinity
  private dx1 = -Infinity; private dy1 = -Infinity
  private hasDirty = false

  private lastX: number | null = null
  private lastY: number | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.beforeSnapshot = context.activeLayer.getImageData()
    this.hasDirty = false
    this.dx0 = this.dy0 = Infinity
    this.dx1 = this.dy1 = -Infinity
    this.resetMask(context)
    this.lastX = event.x
    this.lastY = event.y
    this.drawDab(event.x, event.y, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.lastX === null) return
    this.drawLine(this.lastX, this.lastY!, event.x, event.y, context)
    this.lastX = event.x
    this.lastY = event.y
  }

  onPointerUp(_event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.hasDirty) {
      this.reset()
      return null
    }

    const layer = context.activeLayer
    const dr = toLayerRect(layer, {
      x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0,
    })
    if (!dr) { this.reset(); return null }

    const entry: HistoryEntry = {
      description: 'Eraser stroke',
      layerId: layer.id,
      dirtyRect: dr,
      beforePixels: extractRect(this.beforeSnapshot, dr.x, dr.y, dr.w, dr.h),
      afterPixels:  layer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    }
    this.reset()
    context.requestRender()
    return entry
  }

  getCursor(): string { return 'crosshair' }

  private drawLine(x0: number, y0: number, x1: number, y1: number, context: ToolContext): void {
    const dist = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(dist / (this.size * 0.25)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.drawDab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, context)
    }
  }

  private drawDab(x: number, y: number, context: ToolContext): void {
    if (!this.maskCtx) return
    const r = dabRadius(this.params)

    drawBrushDab(this.maskCtx, x, y, this.params, [0, 0, 0, 255])
    context.selectionMask?.clip(this.maskCtx, x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2)

    // Only the region this dab touched needs re-deriving; everywhere else the
    // layer already reflects the mask as it stood.
    this.applyMask(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2, context)
    this.expandDirty(x, y, r, context)
    context.requestRender()
  }

  /**
   * Rewind a patch of the layer to its pre-stroke state and subtract the whole
   * accumulated mask from it once. Because the mask is applied to untouched
   * pixels every time, overlapping dabs can never compound.
   */
  private applyMask(x: number, y: number, w: number, h: number, context: ToolContext): void {
    const layer = context.activeLayer
    const ox = layer.offsetX, oy = layer.offsetY

    const lx0 = Math.max(0, Math.floor(x - ox))
    const ly0 = Math.max(0, Math.floor(y - oy))
    const lx1 = Math.min(layer.canvas.width,  Math.ceil(x + w - ox))
    const ly1 = Math.min(layer.canvas.height, Math.ceil(y + h - oy))
    if (lx1 <= lx0 || ly1 <= ly0) return

    const ctx = layer.ctx
    // putImageData ignores clipping and composite mode, so this restores the
    // patch verbatim before the mask goes back on.
    ctx.putImageData(this.beforeSnapshot!, 0, 0, lx0, ly0, lx1 - lx0, ly1 - ly0)

    ctx.save()
    ctx.beginPath()
    ctx.rect(lx0, ly0, lx1 - lx0, ly1 - ly0)
    ctx.clip()
    ctx.globalCompositeOperation = 'destination-out'
    // One application of the user's opacity for the whole stroke — matching how
    // the paintbrush scales its staged stroke on commit.
    ctx.globalAlpha = strokeOpacity(this.params)
    ctx.drawImage(this.mask!, -ox, -oy)
    ctx.restore()
    layer.markDirty()
  }

  private resetMask(context: ToolContext): void {
    const w = context.canvasWidth, h = context.canvasHeight
    if (!this.mask || this.mask.width !== w || this.mask.height !== h) {
      this.mask = new OffscreenCanvas(w, h)
      this.maskCtx = this.mask.getContext('2d')!
    }
    this.maskCtx!.clearRect(0, 0, w, h)
  }

  private expandDirty(x: number, y: number, r: number, context: ToolContext): void {
    this.dx0 = Math.min(this.dx0, Math.max(0, Math.floor(x - r) - 1))
    this.dy0 = Math.min(this.dy0, Math.max(0, Math.floor(y - r) - 1))
    this.dx1 = Math.max(this.dx1, Math.min(context.canvasWidth,  Math.ceil(x + r) + 1))
    this.dy1 = Math.max(this.dy1, Math.min(context.canvasHeight, Math.ceil(y + r) + 1))
    this.hasDirty = true
  }

  private reset(): void {
    this.beforeSnapshot = null
    this.hasDirty = false
    this.lastX = null
    this.lastY = null
    if (this.mask && this.maskCtx) {
      this.maskCtx.clearRect(0, 0, this.mask.width, this.mask.height)
    }
  }
}
