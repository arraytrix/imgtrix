export interface BrushParams {
  size:      number  // diameter in px
  opacity:   number  // 0–1 master opacity (max per-stroke)
  hardness:  number  // 0–1; 1 = hard solid edge, 0 = full radial gradient
  softness:  number  // 0–1; extra blur feathering beyond the radius
  rotation:  number  // degrees
  thickness: number  // 0–1; 1 = circular, <1 = elliptical (makes rotation visible)
  flow:     number  // 0–100; 0 = opacity caps each stroke (no accumulation), 100 = fast fill
}

export const DEFAULT_BRUSH: BrushParams = {
  size:      8,
  opacity:   1,
  hardness:  1,
  softness:  0,
  rotation:  0,
  thickness: 1,
  flow:     0,
}

// ─── String caches ───────────────────────────────────────────────────────────
// CSS strings are allocated once and reused across dabs when params are unchanged.
let _fillStyle = '', _fillR = -1, _fillG = -1, _fillB = -1, _fillA = -1
function cachedFillStyle(r: number, g: number, b: number, a: number): string {
  if (r !== _fillR || g !== _fillG || b !== _fillB || a !== _fillA) {
    _fillR = r; _fillG = g; _fillB = b; _fillA = a
    _fillStyle = `rgba(${r},${g},${b},${a})`
  }
  return _fillStyle
}

let _filterStr = '', _filterBlur = -1
function cachedFilter(blurPx: number): string {
  if (blurPx !== _filterBlur) {
    _filterBlur = blurPx
    _filterStr  = `blur(${blurPx.toFixed(1)}px)`
  }
  return _filterStr
}

/**
 * Draw a single brush dab at (x, y) into ctx.
 * color is [r, g, b, a] 0–255.
 *
 * flow splits opacity between dab and compositor:
 *   dabOpacity  = lerp(1.0, opacity, flow/100)  — what we draw here
 *   strokeOpacity = lerp(opacity, 1.0, flow/100) — compositor scales strokeCanvas by this
 * At flow=0: dab is full-opacity; compositor shows strokeCanvas at userOpacity → no accumulation.
 * At flow=100: dab is userOpacity; compositor at 1.0 → classic accumulating fill.
 */
export function drawBrushDab(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  params: BrushParams,
  color: [number, number, number, number],
  compositeOp: GlobalCompositeOperation = 'source-over'
): void {
  const r          = params.size / 2
  const dabOpacity = 1.0 - (1.0 - params.opacity) * (params.flow / 100)
  const alpha      = dabOpacity * (color[3] / 255)
  const blurPx     = params.softness * r * 0.5
  const [cr, cg, cb] = color

  ctx.save()
  ctx.globalCompositeOperation = compositeOp
  ctx.translate(x, y)
  ctx.rotate(params.rotation * Math.PI / 180)
  ctx.scale(1, Math.max(0.01, params.thickness))
  if (blurPx > 0.5) ctx.filter = cachedFilter(blurPx)

  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)

  if (params.hardness >= 1) {
    ctx.fillStyle = cachedFillStyle(cr, cg, cb, alpha)
  } else {
    const innerR = Math.max(0, params.hardness * r - 0.5)
    const grad = ctx.createRadialGradient(0, 0, innerR, 0, 0, r)
    grad.addColorStop(0, cachedFillStyle(cr, cg, cb, alpha))
    grad.addColorStop(1, cachedFillStyle(cr, cg, cb, 0))
    ctx.fillStyle = grad
  }

  ctx.fill()
  ctx.restore()
}

/** Conservative radius for dirty-rect expansion (accounts for softness blur). */
export function dabRadius(params: BrushParams): number {
  const r = params.size / 2
  return r + params.softness * r * 0.5
}

/** Opacity to apply when the compositor draws the strokeCanvas onto the display. */
export function strokeOpacity(params: BrushParams): number {
  return params.opacity + (1 - params.opacity) * (params.flow / 100)
}
