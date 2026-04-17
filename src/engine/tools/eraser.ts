import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'
import { drawBrushDab, dabRadius, type BrushParams } from './brush-params'

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
  private dirtyRect = { x: 0, y: 0, w: 0, h: 0 }
  private hasDirty = false
  private lastX: number | null = null
  private lastY: number | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.beforeSnapshot = context.activeLayer.getImageData()
    this.hasDirty = false
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

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.hasDirty) {
      this.reset()
      return null
    }
    context.requestRender()
    const dr = this.dirtyRect
    const entry: HistoryEntry = {
      description: 'Eraser stroke',
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
    const dist = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(dist / (this.size * 0.25)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.drawDab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, context)
    }
  }

  private drawDab(x: number, y: number, context: ToolContext): void {
    // Eraser draws onto the active layer directly with destination-out.
    // Convert from doc coords to layer-local coords by subtracting the layer offset.
    const lx = x - context.activeLayer.offsetX
    const ly = y - context.activeLayer.offsetY
    drawBrushDab(context.activeLayer.ctx, lx, ly, this.params, [0, 0, 0, 255], 'destination-out')
    context.activeLayer.markDirty()
    this.expandDirty(x, y, dabRadius(this.params), context)
    context.requestRender()
  }

  private expandDirty(x: number, y: number, r: number, ctx: ToolContext): void {
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(ctx.canvasWidth - 1, Math.ceil(x + r))
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
    this.hasDirty = false
    this.lastX = null
    this.lastY = null
  }
}
