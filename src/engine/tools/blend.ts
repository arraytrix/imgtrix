import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'

export class BlendTool implements Tool {
  size     = 40
  hardness = 0.5
  strength = 80   // 1–100: how aggressively pixels are smeared

  private smudgeBuffer: Uint8ClampedArray | null = null
  private smudgeBufDiam = 0

  private beforeSnapshot: ImageData | null = null
  private hasDirty = false
  private dirtyX0 = Infinity;  private dirtyY0 = Infinity
  private dirtyX1 = -Infinity; private dirtyY1 = -Infinity

  private lastX: number | null = null
  private lastY: number | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const r = Math.ceil(this.size / 2)
    const ox = context.activeLayer.offsetX, oy = context.activeLayer.offsetY
    this.smudgeBufDiam = r * 2
    this.smudgeBuffer  = this.readPatch(context, Math.round(event.x - ox), Math.round(event.y - oy), r)
    this.beforeSnapshot  = context.activeLayer.getImageData()
    this.hasDirty      = false
    this.dirtyX0 = this.dirtyY0 = Infinity
    this.dirtyX1 = this.dirtyY1 = -Infinity
    this.lastX = event.x
    this.lastY = event.y
    this.dab(event.x, event.y, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.lastX === null) return
    this.drawLine(this.lastX, this.lastY!, event.x, event.y, context)
    this.lastX = event.x
    this.lastY = event.y
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.hasDirty) { this.reset(); return null }
    const dr = {
      x: Math.max(0, this.dirtyX0),
      y: Math.max(0, this.dirtyY0),
      w: this.dirtyX1 - this.dirtyX0,
      h: this.dirtyY1 - this.dirtyY0,
    }
    const entry: HistoryEntry = {
      description: 'Blend stroke',
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
    if (!this.smudgeBuffer) return

    const r   = this.size / 2
    const ir  = Math.ceil(r)
    const d   = ir * 2
    const W   = context.activeLayer.canvas.width
    const H   = context.activeLayer.canvas.height
    const str = this.strength / 100

    // Convert from doc coords to layer-local coords
    const ox = context.activeLayer.offsetX, oy = context.activeLayer.offsetY
    const icx = Math.round(cx - ox)
    const icy = Math.round(cy - oy)
    const bx0 = icx - ir  // top-left of smudge buffer in layer space
    const by0 = icy - ir

    // Clamp read/write region to layer canvas bounds
    const rx0 = Math.max(0, bx0), ry0 = Math.max(0, by0)
    const rx1 = Math.min(W, bx0 + d), ry1 = Math.min(H, by0 + d)
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

        // Smudge buffer index (may be partially OOB if buffer partially outside canvas)
        const bCol = cpx - bx0
        const bRow = cpy - by0
        const bi = (bRow * d + bCol) * 4
        const pi = (row * rw + col) * 4
        const a = str * fo

        // Deposit smudge color onto canvas
        pix[pi]   = pix[pi]   + (this.smudgeBuffer![bi]   - pix[pi])   * a
        pix[pi+1] = pix[pi+1] + (this.smudgeBuffer![bi+1] - pix[pi+1]) * a
        pix[pi+2] = pix[pi+2] + (this.smudgeBuffer![bi+2] - pix[pi+2]) * a
        pix[pi+3] = pix[pi+3] + (this.smudgeBuffer![bi+3] - pix[pi+3]) * a
      }
    }

    context.activeLayer.ctx.putImageData(imgData, rx0, ry0)
    context.activeLayer.markDirty()

    // Update smudge buffer: mix old smudge with fresh canvas pixels.
    // High strength = retain more original colour (long streak).
    // Low strength  = pick up canvas quickly (short streak).
    const fresh = this.readPatch(context, icx, icy, ir)
    const carry = str * 0.97          // proportion of old smudge to retain
    for (let i = 0; i < d * d * 4; i++) {
      this.smudgeBuffer![i] = this.smudgeBuffer![i] * carry + fresh[i] * (1 - carry)
    }

    // Expand dirty rect
    this.dirtyX0 = Math.min(this.dirtyX0, rx0); this.dirtyY0 = Math.min(this.dirtyY0, ry0)
    this.dirtyX1 = Math.max(this.dirtyX1, rx1); this.dirtyY1 = Math.max(this.dirtyY1, ry1)
    this.hasDirty = true
    context.requestRender()
  }

  /** Read a 2r × 2r patch from the active layer centered at (cx, cy) in layer-local coords. OOB pixels = transparent. */
  private readPatch(context: ToolContext, cx: number, cy: number, r: number): Uint8ClampedArray {
    const d   = r * 2
    const W   = context.activeLayer.canvas.width, H = context.activeLayer.canvas.height
    const bx0 = cx - r, by0 = cy - r
    const rx0 = Math.max(0, bx0), ry0 = Math.max(0, by0)
    const rx1 = Math.min(W, bx0 + d), ry1 = Math.min(H, by0 + d)
    const buf = new Uint8ClampedArray(d * d * 4)
    if (rx1 <= rx0 || ry1 <= ry0) return buf
    const src = context.activeLayer.ctx.getImageData(rx0, ry0, rx1 - rx0, ry1 - ry0).data
    const sw  = rx1 - rx0
    for (let row = 0; row < ry1 - ry0; row++) {
      for (let col = 0; col < rx1 - rx0; col++) {
        const si = (row * sw + col) * 4
        const di = ((ry0 - by0 + row) * d + (rx0 - bx0 + col)) * 4
        buf[di] = src[si]; buf[di+1] = src[si+1]; buf[di+2] = src[si+2]; buf[di+3] = src[si+3]
      }
    }
    return buf
  }

  private reset(): void {
    this.beforeSnapshot = null
    this.smudgeBuffer = null
    this.hasDirty     = false
    this.lastX        = null
    this.lastY        = null
  }
}
