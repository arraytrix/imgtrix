import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'

export type SaturationMode = 'up' | 'down'

export class SaturationTool implements Tool {
  size     = 40
  hardness = 0.5
  strength = 50   // 1–100

  mode: SaturationMode = 'up'
  readonly onRightClickDrags = true

  private beforeSnapshot: ImageData | null = null
  private hasDirty = false
  private dirtyX0 = Infinity;  private dirtyY0 = Infinity
  private dirtyX1 = -Infinity; private dirtyY1 = -Infinity

  private lastX: number | null = null
  private lastY: number | null = null
  private activeMode: SaturationMode = 'up'

  onRightClick(event: ToolEvent, context: ToolContext): void {
    this.beforeSnapshot = context.activeLayer.getImageData()
    this.hasDirty     = false
    this.dirtyX0 = this.dirtyY0 = Infinity
    this.dirtyX1 = this.dirtyY1 = -Infinity
    this.lastX = event.x
    this.lastY = event.y
    this.activeMode = this.mode
    this.dab(event.x, event.y, context)
  }

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.beforeSnapshot = context.activeLayer.getImageData()
    this.hasDirty     = false
    this.dirtyX0 = this.dirtyY0 = Infinity
    this.dirtyX1 = this.dirtyY1 = -Infinity
    this.lastX = event.x
    this.lastY = event.y
    this.activeMode = this.mode === 'up' ? 'down' : 'up'
    this.dab(event.x, event.y, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.lastX === null) return
    this.drawLine(this.lastX, this.lastY!, event.x, event.y, context)
    this.lastX = event.x
    this.lastY = event.y
  }

  onPointerUp(_event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.hasDirty) { this.reset(); return null }
    const dr = {
      x: Math.max(0, this.dirtyX0),
      y: Math.max(0, this.dirtyY0),
      w: this.dirtyX1 - this.dirtyX0,
      h: this.dirtyY1 - this.dirtyY0,
    }
    const entry: HistoryEntry = {
      description: this.activeMode === 'up' ? 'Saturate' : 'Desaturate',
      layerId: context.activeLayer.id,
      dirtyRect: dr,
      beforePixels: extractRect(this.beforeSnapshot, dr.x, dr.y, dr.w, dr.h),
      afterPixels:  context.activeLayer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'crosshair' }

  private drawLine(x0: number, y0: number, x1: number, y1: number, context: ToolContext): void {
    const dist  = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(dist / (this.size * 0.15)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, context)
    }
  }

  private dab(cx: number, cy: number, context: ToolContext): void {
    const r  = this.size / 2
    const ir = Math.ceil(r)
    const W  = context.activeLayer.canvas.width
    const H  = context.activeLayer.canvas.height
    const str = this.strength / 100

    // Convert from doc coords to layer-local coords
    const ox = context.activeLayer.offsetX, oy = context.activeLayer.offsetY
    const icx = Math.round(cx - ox)
    const icy = Math.round(cy - oy)

    const rx0 = Math.max(0, icx - ir), ry0 = Math.max(0, icy - ir)
    const rx1 = Math.min(W, icx + ir), ry1 = Math.min(H, icy + ir)
    if (rx1 <= rx0 || ry1 <= ry0) return

    const rw = rx1 - rx0, rh = ry1 - ry0
    const imgData = context.activeLayer.ctx.getImageData(rx0, ry0, rw, rh)
    const pix = imgData.data

    const rSq      = r * r
    const innerR   = this.hardness * r
    const innerRSq = innerR * innerR
    const falloffRange = r - innerR

    for (let row = 0; row < rh; row++) {
      for (let col = 0; col < rw; col++) {
        const dx = rx0 + col - icx
        const dy = ry0 + row - icy
        const distSq = dx * dx + dy * dy
        if (distSq >= rSq) continue
        let fo: number
        if (distSq <= innerRSq) {
          fo = 1
        } else {
          const dist = Math.sqrt(distSq)
          fo = falloffRange > 0 ? 1 - (dist - innerR) / falloffRange : 1
        }

        const pi = (row * rw + col) * 4
        if (pix[pi + 3] === 0) continue   // skip fully transparent pixels

        const rr = pix[pi], gg = pix[pi + 1], bb = pix[pi + 2]
        const gray = 0.299 * rr + 0.587 * gg + 0.114 * bb
        const amt = str * fo

        if (this.activeMode === 'up') {
          // Boost each channel away from its luminance equivalent
          pix[pi]     = Math.min(255, Math.max(0, rr + (rr - gray) * amt))
          pix[pi + 1] = Math.min(255, Math.max(0, gg + (gg - gray) * amt))
          pix[pi + 2] = Math.min(255, Math.max(0, bb + (bb - gray) * amt))
        } else {
          // Pull each channel toward gray
          pix[pi]     = rr + (gray - rr) * amt
          pix[pi + 1] = gg + (gray - gg) * amt
          pix[pi + 2] = bb + (gray - bb) * amt
        }
      }
    }

    context.activeLayer.ctx.putImageData(imgData, rx0, ry0)
    context.activeLayer.markDirty()

    this.dirtyX0 = Math.min(this.dirtyX0, rx0); this.dirtyY0 = Math.min(this.dirtyY0, ry0)
    this.dirtyX1 = Math.max(this.dirtyX1, rx1); this.dirtyY1 = Math.max(this.dirtyY1, ry1)
    this.hasDirty = true
    context.requestRender()
  }

  private reset(): void {
    this.beforeSnapshot = null
    this.hasDirty     = false
    this.lastX        = null
    this.lastY        = null
  }
}
