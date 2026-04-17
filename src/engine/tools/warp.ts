import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { WarpWebGL } from '../warp-webgl'

export type WarpMode = 'push' | 'twirl' | 'bloat' | 'pucker' | 'reconstruct'

export class WarpTool implements Tool {
  size     = 80
  hardness = 0.5   // 0–1
  strength = 50    // 1–100

  mode: WarpMode = 'push'

  // Lazy-initialised; GL context + shader survive across strokes
  private warpGL = new WarpWebGL()
  private useGL  = false

  // Snapshot kept for CPU fallback only; null when GPU path is active
  private snapshotData: ImageData | null = null

  private dispX: Float32Array | null = null
  private dispY: Float32Array | null = null
  private beforePixels: ArrayBuffer | null = null
  private hasDirty = false

  // Bounding box of pixels whose displacement has been touched this stroke
  private affX0 = 0; private affY0 = 0; private affX1 = 0; private affY1 = 0
  private hasAff = false

  private lastX: number | null = null
  private lastY: number | null = null
  private W = 0
  private H = 0

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.W = context.activeLayer.canvas.width
    this.H = context.activeLayer.canvas.height
    this.beforePixels = context.activeLayer.getImageData().data.buffer.slice(0)
    this.dispX = new Float32Array(this.W * this.H)
    this.dispY = new Float32Array(this.W * this.H)
    this.hasDirty = false
    this.hasAff   = false
    this.lastX    = event.x
    this.lastY    = event.y

    // Try GPU path; fall back to CPU snapshot if unavailable
    this.useGL = this.warpGL.beginStroke(this.W, this.H, context.activeLayer.canvas)
    if (!this.useGL) {
      this.snapshotData = context.activeLayer.getImageData()
    }

    const ox = context.activeLayer.offsetX, oy = context.activeLayer.offsetY
    this.applyDab(event.x - ox, event.y - oy, 0, 0, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.lastX === null) return
    const dx = event.x - this.lastX
    const dy = event.y - this.lastY!
    const ox = context.activeLayer.offsetX, oy = context.activeLayer.offsetY
    this.applyDab(event.x - ox, event.y - oy, dx, dy, context)
    this.lastX = event.x
    this.lastY = event.y
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforePixels || !this.hasDirty) { this.reset(); return null }
    const afterPixels = context.activeLayer.getImageData().data.buffer.slice(0)
    const entry: HistoryEntry = {
      description: `Warp (${this.mode})`,
      layerId: context.activeLayer.id,
      dirtyRect: { x: 0, y: 0, w: this.W, h: this.H },
      beforePixels: this.beforePixels,
      afterPixels,
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'crosshair' }

  private applyDab(cx: number, cy: number, dx: number, dy: number, context: ToolContext): void {
    if (!this.dispX || !this.dispY) return
    const r   = this.size / 2
    const str = this.strength / 100

    const px0 = Math.max(0, Math.floor(cx - r))
    const py0 = Math.max(0, Math.floor(cy - r))
    const px1 = Math.min(this.W - 1, Math.ceil(cx + r))
    const py1 = Math.min(this.H - 1, Math.ceil(cy + r))

    const rSq = r * r
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const relX = px - cx
        const relY = py - cy
        const distSq = relX * relX + relY * relY
        if (distSq >= rSq) continue
        const dist = Math.sqrt(distSq)
        const fo   = this.falloff(dist, r)
        if (fo <= 0) continue
        const i = py * this.W + px
        this.updatePixelDisp(i, relX, relY, dist, dx, dy, fo, str)
      }
    }

    // Expand affected rect
    if (!this.hasAff) {
      this.affX0 = px0; this.affY0 = py0; this.affX1 = px1; this.affY1 = py1
      this.hasAff = true
    } else {
      this.affX0 = Math.min(this.affX0, px0); this.affY0 = Math.min(this.affY0, py0)
      this.affX1 = Math.max(this.affX1, px1); this.affY1 = Math.max(this.affY1, py1)
    }

    this.reapply(context)
    this.hasDirty = true
    context.requestRender()
  }

  private updatePixelDisp(
    i: number,
    relX: number, relY: number, dist: number,
    dx: number, dy: number, fo: number, str: number,
  ): void {
    switch (this.mode) {
      case 'push':
        this.dispX![i] -= dx * str * fo * 0.5
        this.dispY![i] -= dy * str * fo * 0.5
        break

      case 'bloat': {
        if (dist < 0.5) break
        const mag = str * fo * 2
        this.dispX![i] -= (relX / dist) * mag
        this.dispY![i] -= (relY / dist) * mag
        break
      }

      case 'pucker': {
        if (dist < 0.5) break
        const mag = str * fo * 2
        this.dispX![i] += (relX / dist) * mag
        this.dispY![i] += (relY / dist) * mag
        break
      }

      case 'twirl': {
        const angle = str * fo * 0.12
        const cosA = Math.cos(angle), sinA = Math.sin(angle)
        this.dispX![i] += relX * (cosA - 1) - relY * sinA
        this.dispY![i] += relX * sinA       + relY * (cosA - 1)
        break
      }

      case 'reconstruct':
        this.dispX![i] *= Math.max(0, 1 - str * fo * 0.25)
        this.dispY![i] *= Math.max(0, 1 - str * fo * 0.25)
        break
    }
  }

  private reapply(context: ToolContext): void {
    if (!this.dispX || !this.dispY || !this.hasAff) return
    const W = this.W, H = this.H

    // Output rect: affected brush area + margin for inward-displaced samples
    const margin = Math.ceil(this.size / 2)
    const rx0 = Math.max(0, this.affX0 - margin)
    const ry0 = Math.max(0, this.affY0 - margin)
    const rx1 = Math.min(W - 1, this.affX1 + margin)
    const ry1 = Math.min(H - 1, this.affY1 + margin)
    const rw  = rx1 - rx0 + 1
    const rh  = ry1 - ry0 + 1

    if (this.useGL) {
      // ── GPU path ──────────────────────────────────────────────────────────
      // Upload only the displacement sub-region that changed this dab.
      // The disp sub-rect must be at least as large as the output rect so that
      // the shader can look up every displaced source coordinate correctly.
      this.warpGL.updateDisp(this.dispX, this.dispY, rx0, ry0, rx1, ry1)
      const pixels = this.warpGL.render(rx0, ry0, rw, rh)
      if (pixels) {
        context.activeLayer.putImageData(new ImageData(pixels, rw, rh), rx0, ry0)
        return
      }
      // render() returning null means GL failed mid-stroke; fall through to CPU
    }

    // ── CPU fallback ──────────────────────────────────────────────────────
    if (!this.snapshotData) return
    const src = this.snapshotData.data
    const out = new Uint8ClampedArray(rw * rh * 4)

    for (let py = ry0; py <= ry1; py++) {
      for (let px = rx0; px <= rx1; px++) {
        const i  = py * W + px
        const sx = px + this.dispX[i]
        const sy = py + this.dispY[i]
        const oi = ((py - ry0) * rw + (px - rx0)) * 4

        const nx = Math.round(sx), ny = Math.round(sy)
        const s = this.snap(src, W, H, nx, ny)
        out[oi]   = s[0]
        out[oi+1] = s[1]
        out[oi+2] = s[2]
        out[oi+3] = s[3]
      }
    }

    context.activeLayer.putImageData(new ImageData(out, rw, rh), rx0, ry0)
  }

  private snap(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): [number, number, number, number] {
    if (x < 0 || x >= w || y < 0 || y >= h) return [0, 0, 0, 0]
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }

  private falloff(dist: number, r: number): number {
    if (dist >= r) return 0
    const innerR = this.hardness * r
    if (dist <= innerR) return 1
    return 1 - (dist - innerR) / (r - innerR)
  }

  private reset(): void {
    this.beforePixels = null
    this.snapshotData = null
    this.dispX        = null
    this.dispY        = null
    this.hasDirty     = false
    this.hasAff       = false
    this.lastX        = null
    this.lastY        = null
    this.useGL        = false
    // warpGL context survives — reused on the next stroke
  }
}
