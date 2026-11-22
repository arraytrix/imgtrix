import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'

/**
 * Which parts of the brush color replace the pixel's own. These are the
 * non-separable blend modes from the W3C compositing spec, with the brush color
 * as the source and the layer pixel as the backdrop.
 *   color      — brush hue + saturation, pixel lightness (classic recolor)
 *   hue        — brush hue only; grays stay gray
 *   saturation — brush saturation only
 *   luminosity — brush lightness only
 */
export type RecolorMode = 'color' | 'hue' | 'saturation' | 'luminosity'

export class RecolorTool implements Tool {
  color: [number, number, number, number] = [0, 0, 0, 255]

  size      = 40
  hardness  = 0.5
  strength  = 100   // 1–100; the most a single stroke can move a pixel toward the target
  mode: RecolorMode = 'color'

  /** When on, only pixels close to the color sampled at the start of the stroke are recolored. */
  matchColor = true
  tolerance  = 48   // 0–255, max per-channel RGB difference from the sampled color

  private beforeSnapshot: ImageData | null = null
  // Strongest coverage each layer pixel has received this stroke (0–255). Every
  // dab recomputes from the original pixels up to this level, so overlapping
  // dabs don't compound — a stroke behaves like the paintbrush at flow 0, and
  // matching against the sample keeps working after a pixel has been recolored.
  private coverage: Uint8Array | null = null
  private sample: [number, number, number] | null = null
  // blend() writes here so the per-pixel loop doesn't allocate.
  private out: [number, number, number] = [0, 0, 0]
  private hasDirty = false
  private dirtyX0 = Infinity;  private dirtyY0 = Infinity
  private dirtyX1 = -Infinity; private dirtyY1 = -Infinity

  private lastX: number | null = null
  private lastY: number | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const layer = context.activeLayer
    const W = layer.canvas.width, H = layer.canvas.height
    this.beforeSnapshot = layer.getImageData()
    if (!this.coverage || this.coverage.length !== W * H) this.coverage = new Uint8Array(W * H)
    else this.coverage.fill(0)
    this.hasDirty = false
    this.dirtyX0 = this.dirtyY0 = Infinity
    this.dirtyX1 = this.dirtyY1 = -Infinity
    this.sample = this.sampleAt(event.x, event.y, context)
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

  onPointerUp(_event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.hasDirty) { this.reset(); return null }
    const dr = {
      x: this.dirtyX0,
      y: this.dirtyY0,
      w: this.dirtyX1 - this.dirtyX0,
      h: this.dirtyY1 - this.dirtyY0,
    }
    const entry: HistoryEntry = {
      description: 'Recolor',
      layerId: context.activeLayer.id,
      dirtyRect: dr,
      beforePixels: extractRect(this.beforeSnapshot, dr.x, dr.y, dr.w, dr.h),
      afterPixels:  context.activeLayer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'crosshair' }

  /** Color under the cursor in the untouched layer, or null if there's nothing opaque there. */
  private sampleAt(x: number, y: number, context: ToolContext): [number, number, number] | null {
    const snap = this.beforeSnapshot!
    const lx = Math.floor(x - context.activeLayer.offsetX)
    const ly = Math.floor(y - context.activeLayer.offsetY)
    if (lx < 0 || ly < 0 || lx >= snap.width || ly >= snap.height) return null
    const i = (ly * snap.width + lx) * 4
    if (snap.data[i + 3] === 0) return null
    return [snap.data[i], snap.data[i + 1], snap.data[i + 2]]
  }

  private drawLine(x0: number, y0: number, x1: number, y1: number, context: ToolContext): void {
    const dist  = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(dist / (this.size * 0.15)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, context)
    }
  }

  private dab(cx: number, cy: number, context: ToolContext): void {
    if (this.matchColor && !this.sample) return
    const snap     = this.beforeSnapshot!
    const coverage = this.coverage!
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
    const pix  = imgData.data
    const orig = snap.data
    const mask = context.selectionMask

    const rSq      = r * r
    const innerR   = this.hardness * r
    const innerRSq = innerR * innerR
    const falloffRange = r - innerR

    // Tolerance gets a soft shoulder over its top quarter so the boundary
    // between matched and unmatched pixels doesn't alias.
    const tol  = this.tolerance
    const soft = Math.max(1, tol * 0.25)
    const [sr, sg, sb] = this.sample ?? [0, 0, 0]

    const src = this.color
    const sR = src[0] / 255, sG = src[1] / 255, sB = src[2] / 255
    const out = this.out
    let changed = false

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

        const lp = (ry0 + row) * W + rx0 + col
        const cov = Math.round(str * fo * 255)
        if (cov <= coverage[lp]) continue

        if (mask && !mask.contains(rx0 + col + ox, ry0 + row + oy)) continue

        const oi = lp * 4
        if (orig[oi + 3] === 0) continue   // skip fully transparent pixels
        const br = orig[oi], bg = orig[oi + 1], bb = orig[oi + 2]

        let match = 1
        if (this.matchColor) {
          const d = Math.max(Math.abs(br - sr), Math.abs(bg - sg), Math.abs(bb - sb))
          if (d > tol) continue
          match = Math.min(1, (tol - d) / soft)
        }

        coverage[lp] = cov
        this.blend(br / 255, bg / 255, bb / 255, sR, sG, sB)
        const amt = (cov / 255) * match
        const pi  = (row * rw + col) * 4
        pix[pi]     = br + (out[0] * 255 - br) * amt
        pix[pi + 1] = bg + (out[1] * 255 - bg) * amt
        pix[pi + 2] = bb + (out[2] * 255 - bb) * amt
        changed = true
      }
    }

    if (!changed) return
    context.activeLayer.ctx.putImageData(imgData, rx0, ry0)
    context.activeLayer.markDirty()

    this.dirtyX0 = Math.min(this.dirtyX0, rx0); this.dirtyY0 = Math.min(this.dirtyY0, ry0)
    this.dirtyX1 = Math.max(this.dirtyX1, rx1); this.dirtyY1 = Math.max(this.dirtyY1, ry1)
    this.hasDirty = true
    context.requestRender()
  }

  // ─── Non-separable blend math (all channels 0–1) ───────────────────────────

  private blend(br: number, bg: number, bb: number, sr: number, sg: number, sb: number): void {
    const o = this.out
    switch (this.mode) {
      case 'color':
        setLum(sr, sg, sb, lum(br, bg, bb), o)
        break
      case 'hue':
        setSat(sr, sg, sb, sat(br, bg, bb), o)
        setLum(o[0], o[1], o[2], lum(br, bg, bb), o)
        break
      case 'saturation':
        setSat(br, bg, bb, sat(sr, sg, sb), o)
        setLum(o[0], o[1], o[2], lum(br, bg, bb), o)
        break
      case 'luminosity':
        setLum(br, bg, bb, lum(sr, sg, sb), o)
        break
    }
  }

  private reset(): void {
    this.beforeSnapshot = null
    this.sample       = null
    this.hasDirty     = false
    this.lastX        = null
    this.lastY        = null
  }
}

function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/** Shift (r, g, b) to luminance l, pulling out-of-gamut results back toward gray. */
function setLum(r: number, g: number, b: number, l: number, o: [number, number, number]): void {
  const d = l - lum(r, g, b)
  r += d; g += d; b += d
  const L = lum(r, g, b)
  const n = Math.min(r, g, b)
  const x = Math.max(r, g, b)
  if (n < 0) {
    const k = L / (L - n)
    r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k
  }
  if (x > 1) {
    const k = (1 - L) / (x - L)
    r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k
  }
  o[0] = r; o[1] = g; o[2] = b
}

/** Rescale (r, g, b) so max − min equals s, keeping its hue. */
function setSat(r: number, g: number, b: number, s: number, o: [number, number, number]): void {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const k  = mx > mn ? s / (mx - mn) : 0
  o[0] = (r - mn) * k; o[1] = (g - mn) * k; o[2] = (b - mn) * k
}
