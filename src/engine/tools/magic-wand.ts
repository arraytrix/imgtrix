import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Selection } from '../selection'
import { selection, layerStack } from '../../store'

export class MagicWandTool implements Tool {
  threshold = 32   // 0–255

  private selectionBefore: Selection | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.selectionBefore = get(selection)
    const W  = context.canvasWidth
    const H  = context.canvasHeight
    const cx = Math.round(event.x)
    const cy = Math.round(event.y)
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) return

    // Composite all visible layers so we sample what the user sees
    const offscreen = new OffscreenCanvas(W, H)
    const ctx       = offscreen.getContext('2d')!
    const ls        = get(layerStack)
    for (const layer of ls.layers) {
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha             = layer.opacity
      ctx.globalCompositeOperation = layer.blendMode === 'normal'
        ? 'source-over'
        : layer.blendMode as GlobalCompositeOperation
      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
      ctx.restore()
    }
    const pixels = ctx.getImageData(0, 0, W, H).data

    // BFS flood fill — returns full-canvas mask + tight bounding box
    const { mask, minX, minY, maxX, maxY } = this.floodFill(pixels, W, H, cx, cy)
    if (maxX < 0) { selection.set(null); context.requestRender(); return }

    // Trim mask to bounding box to save memory
    const mw   = maxX - minX + 1
    const mh   = maxY - minY + 1
    const data = new Uint8Array(mw * mh)
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        data[y * mw + x] = mask[(minY + y) * W + (minX + x)]
      }
    }

    const newMask = { type: 'mask' as const, x: minX, y: minY, w: mw, h: mh, data }

    const existing = get(selection)
    if (event.shiftKey && existing) {
      selection.set(this.union(this.toMask(existing, W, H), newMask))
    } else {
      selection.set(newMask)
    }
    context.requestRender()
  }

  onPointerMove(_event: ToolEvent, _context: ToolContext): void {}

  onPointerUp(_event: ToolEvent, _context: ToolContext): HistoryEntry | null {
    return {
      description: 'Magic Wand',
      layerId: '',
      dirtyRect: { x: 0, y: 0, w: 0, h: 0 },
      beforePixels: new ArrayBuffer(0),
      afterPixels:  new ArrayBuffer(0),
      selectionBefore: this.selectionBefore,
      selectionAfter:  get(selection),
    }
  }

  getCursor(): string { return 'crosshair' }

  private toMask(
    sel: Selection,
    W: number, H: number
  ): { type: 'mask'; x: number; y: number; w: number; h: number; data: Uint8Array } {
    if (sel.type === 'mask') return sel

    if (sel.type === 'rect') {
      const data = new Uint8Array(sel.w * sel.h).fill(1)
      return { type: 'mask', x: sel.x, y: sel.y, w: sel.w, h: sel.h, data }
    }

    // lasso — ray-cast point-in-polygon for each pixel in bounding box
    const pts = sel.points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    const lx = Math.max(0, Math.floor(minX))
    const ly = Math.max(0, Math.floor(minY))
    const lx1 = Math.min(W, Math.ceil(maxX))
    const ly1 = Math.min(H, Math.ceil(maxY))
    const lw = lx1 - lx, lh = ly1 - ly
    const data = new Uint8Array(lw * lh)
    for (let row = 0; row < lh; row++) {
      const py = ly + row + 0.5
      for (let col = 0; col < lw; col++) {
        const px = lx + col + 0.5
        let inside = false
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y
          const xj = pts[j].x, yj = pts[j].y
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
            inside = !inside
        }
        if (inside) data[row * lw + col] = 1
      }
    }
    return { type: 'mask', x: lx, y: ly, w: lw, h: lh, data }
  }

  private union(
    a: { type: 'mask'; x: number; y: number; w: number; h: number; data: Uint8Array },
    b: { type: 'mask'; x: number; y: number; w: number; h: number; data: Uint8Array }
  ): { type: 'mask'; x: number; y: number; w: number; h: number; data: Uint8Array } {
    // Combined bounding box
    const ux0 = Math.min(a.x, b.x)
    const uy0 = Math.min(a.y, b.y)
    const ux1 = Math.max(a.x + a.w, b.x + b.w)
    const uy1 = Math.max(a.y + a.h, b.y + b.h)
    const uw  = ux1 - ux0
    const uh  = uy1 - uy0
    const data = new Uint8Array(uw * uh)

    // Paint both masks into the union canvas
    for (const m of [a, b]) {
      const offX = m.x - ux0
      const offY = m.y - uy0
      for (let row = 0; row < m.h; row++) {
        for (let col = 0; col < m.w; col++) {
          if (m.data[row * m.w + col])
            data[(offY + row) * uw + (offX + col)] = 1
        }
      }
    }

    // Trim to tight bounding box
    let minX = uw, minY = uh, maxX = -1, maxY = -1
    for (let row = 0; row < uh; row++) {
      for (let col = 0; col < uw; col++) {
        if (data[row * uw + col]) {
          if (col < minX) minX = col; if (col > maxX) maxX = col
          if (row < minY) minY = row; if (row > maxY) maxY = row
        }
      }
    }
    if (maxX < 0) return a  // shouldn't happen, but safe fallback

    const tw = maxX - minX + 1
    const th = maxY - minY + 1
    const trimmed = new Uint8Array(tw * th)
    for (let row = 0; row < th; row++) {
      for (let col = 0; col < tw; col++) {
        trimmed[row * tw + col] = data[(minY + row) * uw + (minX + col)]
      }
    }
    return { type: 'mask', x: ux0 + minX, y: uy0 + minY, w: tw, h: th, data: trimmed }
  }

  private floodFill(
    pixels: Uint8ClampedArray, W: number, H: number, seedX: number, seedY: number
  ): { mask: Uint8Array; minX: number; minY: number; maxX: number; maxY: number } {
    const mask = new Uint8Array(W * H)
    const si   = (seedY * W + seedX) * 4
    const sr   = pixels[si], sg = pixels[si + 1], sb = pixels[si + 2]
    const thr  = this.threshold

    let minX = seedX, minY = seedY, maxX = seedX, maxY = seedY

    // Use a typed array queue (no shift — O(1) amortized)
    const queue = new Int32Array(W * H)
    let head = 0, tail = 0
    queue[tail++] = seedY * W + seedX
    mask[seedY * W + seedX] = 1

    while (head < tail) {
      const idx = queue[head++]
      const px  = idx % W
      const py  = (idx - px) / W

      const neighbors = [
        px > 0     ? idx - 1 : -1,
        px < W - 1 ? idx + 1 : -1,
        py > 0     ? idx - W : -1,
        py < H - 1 ? idx + W : -1,
      ]

      for (const ni of neighbors) {
        if (ni < 0 || mask[ni]) continue
        const pi = ni * 4
        const dr = pixels[pi] - sr
        const dg = pixels[pi + 1] - sg
        const db = pixels[pi + 2] - sb
        if (Math.sqrt(dr * dr + dg * dg + db * db) <= thr) {
          mask[ni] = 1
          const nx = ni % W
          const ny = (ni - nx) / W
          if (nx < minX) minX = nx; if (nx > maxX) maxX = nx
          if (ny < minY) minY = ny; if (ny > maxY) maxY = ny
          queue[tail++] = ni
        }
      }
    }

    return { mask, minX, minY, maxX, maxY }
  }
}
