import type { Selection } from './selection'

/** Axis-aligned document-space bounds of a selection of any type. */
export function selectionBounds(sel: Selection): { x: number; y: number; w: number; h: number } {
  if (sel.type === 'lasso') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of sel.points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  return { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
}

/**
 * Rotate a selection's shape by `angle` radians about the document-space point
 * (cx, cy). Rectangles become lassos, since a rotated rect is no longer
 * axis-aligned; bitmap masks are re-rasterized through the same rotation the
 * pixels get, so outline and content stay in step.
 */
export function rotateSelectionShape(
  sel: Selection, cx: number, cy: number, angle: number
): Selection {
  if (angle === 0) return sel
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const spin = (x: number, y: number): { x: number; y: number } => {
    const dx = x - cx, dy = y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }

  if (sel.type === 'lasso') {
    return { type: 'lasso', points: sel.points.map(p => spin(p.x, p.y)) }
  }

  if (sel.type === 'rect') {
    return {
      type: 'lasso',
      points: [
        spin(sel.x, sel.y),
        spin(sel.x + sel.w, sel.y),
        spin(sel.x + sel.w, sel.y + sel.h),
        spin(sel.x, sel.y + sel.h),
      ],
    }
  }

  // Bitmap mask: draw it rotated, then read the coverage back out.
  const d  = Math.ceil(Math.hypot(sel.w, sel.h)) + 2
  const cv = new OffscreenCanvas(d, d)
  const ctx = cv.getContext('2d')!
  const src = new OffscreenCanvas(sel.w, sel.h)
  const sctx = src.getContext('2d')!
  const img = sctx.createImageData(sel.w, sel.h)
  for (let i = 0; i < sel.data.length; i++) {
    if (sel.data[i]) img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)

  // The mask's own centre is what rotates about (cx, cy), so draw it rotated
  // in place and then shift by however far that centre moved.
  ctx.translate(d / 2, d / 2)
  ctx.rotate(angle)
  ctx.drawImage(src, -sel.w / 2, -sel.h / 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const moved = spin(sel.x + sel.w / 2, sel.y + sel.h / 2)
  const originX = Math.round(moved.x - d / 2)
  const originY = Math.round(moved.y - d / 2)

  const px = ctx.getImageData(0, 0, d, d).data
  let minX = d, minY = d, maxX = -1, maxY = -1
  const full = new Uint8Array(d * d)
  for (let row = 0; row < d; row++) {
    for (let col = 0; col < d; col++) {
      if (px[(row * d + col) * 4 + 3] >= 128) {
        full[row * d + col] = 1
        if (col < minX) minX = col; if (col > maxX) maxX = col
        if (row < minY) minY = row; if (row > maxY) maxY = row
      }
    }
  }
  if (maxX < 0) return sel  // rotated to nothing; keep what we had

  const tw = maxX - minX + 1, th = maxY - minY + 1
  const data = new Uint8Array(tw * th)
  for (let row = 0; row < th; row++) {
    for (let col = 0; col < tw; col++) {
      data[row * tw + col] = full[(minY + row) * d + (minX + col)]
    }
  }
  return { type: 'mask', x: originX + minX, y: originY + minY, w: tw, h: th, data }
}

/**
 * A selection rasterized to document space, built once per stroke.
 *
 * Two representations are kept because tools need both:
 *  - an alpha canvas, for trimming a whole canvas with `destination-in`
 *    (paint tools that stage into strokeCanvas, and the eraser)
 *  - a byte-per-pixel coverage array, for per-pixel tests inside the tight
 *    loops of the tools that work on ImageData directly
 *
 * The coverage array is derived from the canvas on first use, so tools that
 * only need one representation never pay for the other.
 */
export class SelectionMask {
  /** Document-space bounds of the rasterized region. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number

  private readonly canvas: OffscreenCanvas
  private data: Uint8Array | null = null

  private constructor(x: number, y: number, w: number, h: number, canvas: OffscreenCanvas) {
    this.x = x; this.y = y; this.w = w; this.h = h
    this.canvas = canvas
  }

  /** Rasterize a selection. Returns null for "no selection" (nothing is clipped). */
  static from(sel: Selection | null, docW: number, docH: number): SelectionMask | null {
    if (!sel) return null

    if (sel.type === 'rect') {
      // Normalize, then clamp to the document — pixels outside it can't be painted anyway.
      const rx0 = Math.max(0, Math.floor(Math.min(sel.x, sel.x + sel.w)))
      const ry0 = Math.max(0, Math.floor(Math.min(sel.y, sel.y + sel.h)))
      const rx1 = Math.min(docW, Math.ceil(Math.max(sel.x, sel.x + sel.w)))
      const ry1 = Math.min(docH, Math.ceil(Math.max(sel.y, sel.y + sel.h)))
      const w = rx1 - rx0, h = ry1 - ry0
      if (w <= 0 || h <= 0) return null

      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      return new SelectionMask(rx0, ry0, w, h, canvas)
    }

    if (sel.type === 'lasso') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of sel.points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
      }
      const lx0 = Math.max(0, Math.floor(minX))
      const ly0 = Math.max(0, Math.floor(minY))
      const lx1 = Math.min(docW, Math.ceil(maxX))
      const ly1 = Math.min(docH, Math.ceil(maxY))
      const w = lx1 - lx0, h = ly1 - ly0
      if (w <= 0 || h <= 0) return null

      // Let the rasterizer fill the polygon — far cheaper than a per-pixel
      // ray cast, and the anti-aliased edge feathers the clip nicely.
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      ctx.translate(-lx0, -ly0)
      ctx.beginPath()
      ctx.moveTo(sel.points[0].x, sel.points[0].y)
      for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x, sel.points[i].y)
      ctx.closePath()
      ctx.fillStyle = '#000'
      ctx.fill()
      return new SelectionMask(lx0, ly0, w, h, canvas)
    }

    // Bitmap mask (magic wand). Kept at its own bounds — it may sit partly
    // off-canvas after a move, and `contains` handles that.
    if (sel.w <= 0 || sel.h <= 0) return null
    const canvas = new OffscreenCanvas(sel.w, sel.h)
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(sel.w, sel.h)
    const px  = img.data
    for (let i = 0; i < sel.data.length; i++) {
      if (sel.data[i]) px[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return new SelectionMask(sel.x, sel.y, sel.w, sel.h, canvas)
  }

  /** Is this document-space pixel inside the selection? */
  contains(docX: number, docY: number): boolean {
    const col = Math.floor(docX) - this.x
    const row = Math.floor(docY) - this.y
    if (col < 0 || col >= this.w || row < 0 || row >= this.h) return false
    return this.coverage()[row * this.w + col] === 1
  }

  /**
   * Erase everything outside the selection from `ctx`, limited to the given
   * rect so the cost stays proportional to the area a dab actually touched.
   *
   * Coordinates are document space: the caller must have `ctx` transformed so
   * that document coords map onto it (identity for strokeCanvas).
   */
  clip(
    ctx: OffscreenCanvasRenderingContext2D,
    rx: number, ry: number, rw: number, rh: number
  ): void {
    ctx.save()
    ctx.beginPath()
    ctx.rect(rx, ry, rw, rh)
    ctx.clip()
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(this.canvas, this.x, this.y)
    ctx.restore()
  }

  /**
   * Erase the selected pixels from `ctx`, leaving everything outside intact —
   * the inverse of `clip`. Coordinates are document space, so the caller must
   * have `ctx` transformed accordingly.
   */
  punch(ctx: OffscreenCanvasRenderingContext2D): void {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(this.canvas, this.x, this.y)
    ctx.restore()
  }

  private coverage(): Uint8Array {
    if (!this.data) {
      const px = this.canvas.getContext('2d')!.getImageData(0, 0, this.w, this.h).data
      const d  = new Uint8Array(this.w * this.h)
      for (let i = 0; i < d.length; i++) {
        if (px[i * 4 + 3] >= 128) d[i] = 1
      }
      this.data = d
    }
    return this.data
  }
}
