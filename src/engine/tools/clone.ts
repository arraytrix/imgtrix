import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'
import { strokeOpacity } from './brush-params'

export class CloneTool implements Tool {
  size      = 40
  opacity   = 1
  hardness  = 0.9
  softness  = 0
  rotation  = 0
  thickness = 1
  flow     = 0
  trace     = false

  // Public so CanvasView overlay can read them
  sourcePoint:      { x: number; y: number } | null = null
  currentSourcePos: { x: number; y: number } | null = null

  private sourceOffset:  { x: number; y: number } | null = null
  traceOffset:   { x: number; y: number } | null = null
  private sampleCanvas:  OffscreenCanvas | null = null
  private dabCanvas:     OffscreenCanvas | null = null
  private maskCanvas:    OffscreenCanvas | null = null
  private beforeSnapshot: ImageData | null = null
  private dirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  private hasDirty  = false
  private lastX: number | null = null
  private lastY: number | null = null

  onRightClick(event: ToolEvent, _context: ToolContext): void {
    this.sourcePoint = { x: event.x, y: event.y }
    this.traceOffset = null
  }

  clearTrace(): void {
    this.traceOffset = null
  }

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    if (!this.sourcePoint) return

    if (this.trace) {
      if (!this.traceOffset) {
        this.traceOffset = {
          x: this.sourcePoint.x - event.x,
          y: this.sourcePoint.y - event.y,
        }
      }
      this.sourceOffset = { ...this.traceOffset }
    } else {
      this.sourceOffset = {
        x: this.sourcePoint.x - event.x,
        y: this.sourcePoint.y - event.y,
      }
    }

    // Snapshot active layer so we always sample the pre-stroke pixels
    const { canvas } = context.activeLayer
    this.sampleCanvas = new OffscreenCanvas(canvas.width, canvas.height)
    this.sampleCanvas.getContext('2d')!.drawImage(canvas, 0, 0)

    // Pre-allocate reusable dab/mask canvases sized to current brush
    const dabDiam = Math.ceil(this.size) * 2
    if (!this.dabCanvas || this.dabCanvas.width !== dabDiam) {
      this.dabCanvas  = new OffscreenCanvas(dabDiam, dabDiam)
      this.maskCanvas = new OffscreenCanvas(dabDiam, dabDiam)
    }

    this.beforeSnapshot = context.activeLayer.getImageData()
    this.hasDirty = false
    this.lastX = event.x
    this.lastY = event.y
    this.currentSourcePos = { x: event.x + this.sourceOffset.x, y: event.y + this.sourceOffset.y }
    this.drawDab(event.x, event.y, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.lastX === null || !this.sourceOffset) return
    this.currentSourcePos = { x: event.x + this.sourceOffset.x, y: event.y + this.sourceOffset.y }
    this.drawLine(this.lastX, this.lastY!, event.x, event.y, context)
    this.lastX = event.x
    this.lastY = event.y
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    this.currentSourcePos = null

    if (!this.beforeSnapshot || !this.hasDirty) {
      this.reset()
      return null
    }

    const sOpacity = strokeOpacity({ size: this.size, opacity: this.opacity, hardness: this.hardness, softness: this.softness, rotation: this.rotation, thickness: this.thickness, flow: this.flow })
    const activeCtx = context.activeLayer.ctx
    const ox = context.activeLayer.offsetX
    const oy = context.activeLayer.offsetY
    activeCtx.save()
    activeCtx.globalAlpha = sOpacity
    activeCtx.drawImage(context.strokeCanvas, -ox, -oy)
    activeCtx.restore()
    context.activeLayer.markDirty()

    context.strokeCtx.clearRect(0, 0, context.strokeCanvas.width, context.strokeCanvas.height)
    context.requestRender()

    const dr = this.dirtyRect
    const entry: HistoryEntry = {
      description: 'Clone stroke',
      layerId: context.activeLayer.id,
      dirtyRect: { ...dr },
      beforePixels: extractRect(this.beforeSnapshot, dr.x, dr.y, dr.w, dr.h),
      afterPixels:  context.activeLayer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'crosshair' }

  private drawLine(x0: number, y0: number, x1: number, y1: number, context: ToolContext): void {
    const dist  = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(dist / (this.size * 0.25)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.drawDab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, context)
    }
  }

  private drawDab(x: number, y: number, context: ToolContext): void {
    if (!this.sampleCanvas || !this.sourceOffset) return

    const srcX = x + this.sourceOffset.x
    const srcY = y + this.sourceOffset.y
    const r    = this.size / 2
    const d    = Math.ceil(r * 2)

    // Sample from snapshot into the reusable dab canvas
    const temp    = this.dabCanvas!
    const tempCtx = temp.getContext('2d')!
    tempCtx.clearRect(0, 0, d, d)
    tempCtx.drawImage(this.sampleCanvas, srcX - r, srcY - r, d, d, 0, 0, d, d)

    // Build a hardness-based circular mask in the reusable mask canvas
    const mask    = this.maskCanvas!
    const maskCtx = mask.getContext('2d')!
    maskCtx.clearRect(0, 0, d, d)
    maskCtx.beginPath()
    maskCtx.arc(r, r, r, 0, Math.PI * 2)
    const dabOpacity = 1.0 - (1.0 - this.opacity) * (this.flow / 100)
    if (this.hardness >= 1) {
      maskCtx.fillStyle = `rgba(0,0,0,${dabOpacity})`
    } else {
      const innerR = Math.max(0, this.hardness * r - 0.5)
      const grad = maskCtx.createRadialGradient(r, r, innerR, r, r, r)
      grad.addColorStop(0, `rgba(0,0,0,${dabOpacity})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      maskCtx.fillStyle = grad
    }
    maskCtx.fill()

    // Punch mask into the sample via destination-in
    tempCtx.globalCompositeOperation = 'destination-in'
    tempCtx.drawImage(mask, 0, 0)

    // Blit to strokeCanvas, applying softness blur, rotation, and thickness at draw time
    const { strokeCtx } = context
    strokeCtx.save()
    if (this.softness > 0.01) {
      strokeCtx.filter = `blur(${(this.softness * r * 0.5).toFixed(1)}px)`
    }
    strokeCtx.translate(Math.round(x), Math.round(y))
    if (this.rotation !== 0) strokeCtx.rotate(this.rotation * Math.PI / 180)
    if (this.thickness < 1) strokeCtx.scale(1, Math.max(0.01, this.thickness))
    strokeCtx.drawImage(temp, -r, -r)
    strokeCtx.restore()

    const effectiveR = r + this.softness * r * 0.5
    this.expandDirty(x, y, effectiveR, context)
    context.requestRender()
  }

  private expandDirty(x: number, y: number, r: number, ctx: ToolContext): void {
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(ctx.canvasWidth  - 1, Math.ceil(x + r))
    const y1 = Math.min(ctx.canvasHeight - 1, Math.ceil(y + r))
    if (x1 <= x0 || y1 <= y0) return
    if (!this.hasDirty) {
      this.dirtyRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      this.hasDirty = true
    } else {
      const rx1 = this.dirtyRect.x + this.dirtyRect.w
      const ry1 = this.dirtyRect.y + this.dirtyRect.h
      this.dirtyRect.x = Math.min(this.dirtyRect.x, x0)
      this.dirtyRect.y = Math.min(this.dirtyRect.y, y0)
      this.dirtyRect.w = Math.max(rx1, x1) - this.dirtyRect.x
      this.dirtyRect.h = Math.max(ry1, y1) - this.dirtyRect.y
    }
  }

  private reset(): void {
    this.beforeSnapshot = null
    this.sampleCanvas = null
    this.dabCanvas    = null
    this.maskCanvas   = null
    this.sourceOffset = null
    this.hasDirty = false
    this.lastX = null
    this.lastY = null
  }
}
