import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Layer } from '../layer'
import type { LayerStack } from '../layer-stack'
import type { Selection } from '../selection'
import { SelectionMask, selectionBounds, rotateSelectionShape } from '../selection-mask'
import { selection, layerStack, bump } from '../../store'

export const FLOAT_LAYER_NAME = 'Floating Selection'

/** The tool instance currently holding a floating selection, if any. */
let liveFloat: MoveTool | null = null

/**
 * Forget any floating selection the move tool is tracking, without touching the
 * layer stack. Undo/redo rewrites the float's pixels, offset and selection
 * behind the tool's back, so its cached angle and base shape can no longer be
 * trusted — the next drag has to start over from whatever is on screen.
 */
export function invalidateFloatingSelection(): void {
  liveFloat?.dropFloat()
  liveFloat = null
}

/** Screen-space distance from the selection to the rotation handle. */
const HANDLE_GAP_PX = 28
/** Screen-space grab radius for the rotation handle. */
const HANDLE_HIT_PX = 12
/** Shift-drag snaps rotation to this many degrees. */
const SNAP_DEGREES = 15

/**
 * Move Selection lifts the selected pixels into a layer of their own on the
 * first move or rotate — leaving one hole in the source layer — and then just
 * transforms that layer. Repeated moves and rotations are therefore
 * non-destructive: nothing under the float is ever overwritten.
 *
 * Rotation always re-renders from the pristine lifted pixels rather than from
 * the last rotated result, so spinning a selection back and forth costs exactly
 * one resample no matter how many times it's done.
 *
 * The float is a normal layer, so the user commits it with Merge Down.
 */
export class MoveTool implements Tool {
  private mode: 'idle' | 'move' | 'rotate' = 'idle'
  private dragStartX = 0
  private dragStartY = 0
  private grabAngle  = 0                    // pointer angle when a rotate drag began
  private angleAtGrab = 0                   // float angle when a rotate drag began
  private offsetBefore: { x: number; y: number } | null = null
  private pixelsBefore: ArrayBuffer | null = null
  private selBefore: Selection | null = null
  /** Entry for the lift, when this drag is the one that created the float. */
  private liftEntry: HistoryEntry | null = null

  // ---- Float state, kept across drags ----
  private floatLayer:  Layer | null = null
  private sourceLayer: Layer | null = null
  /** The selection object currently shown for the float; identity detects a new one. */
  private floatSel: Selection | null = null
  /** Selection shape as it was at lift time — every transform derives from this. */
  private floatBase: Selection | null = null
  /** Unrotated lifted pixels; rotation always re-renders from these. */
  private pristine: OffscreenCanvas | null = null
  private contentW = 0
  private contentH = 0
  /** Document-space rotation centre, valid at the lift-time offset. */
  private centerX = 0
  private centerY = 0
  private baseOffsetX = 0
  private baseOffsetY = 0
  private angle = 0                          // radians
  /** Rotating a bitmap mask is costly; reuse the result while the angle holds. */
  private rotCache: { angle: number; shape: Selection } | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const sel  = get(selection)
    const mask = context.selectionMask
    if (!sel || !mask) return

    const handle  = this.getRotateHandle(sel, context.zoom)
    const grabbed = handle !== null &&
      Math.hypot(event.x - handle.hx, event.y - handle.hy) <= HANDLE_HIT_PX / context.zoom

    if (!grabbed && !mask.contains(event.x, event.y)) return

    const ls = get(layerStack)
    const { lift } = this.ensureFloat(ls, sel, mask)

    this.liftEntry  = lift
    this.selBefore  = sel
    this.dragStartX = event.x
    this.dragStartY = event.y

    if (grabbed) {
      this.mode         = 'rotate'
      this.angleAtGrab  = this.angle
      this.grabAngle    = this.pointerAngle(event.x, event.y)
      this.pixelsBefore = lift ? null : this.captureFloat()
    } else {
      this.mode         = 'move'
      this.offsetBefore = { x: this.floatLayer!.offsetX, y: this.floatLayer!.offsetY }
    }

    if (lift) context.requestRender()
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (this.mode === 'idle' || !this.floatLayer) return

    if (this.mode === 'rotate') {
      let next = this.angleAtGrab + (this.pointerAngle(event.x, event.y) - this.grabAngle)
      if (event.shiftKey) {
        const step = (SNAP_DEGREES * Math.PI) / 180
        next = Math.round(next / step) * step
      }
      this.angle = next
      this.renderFloat()
    } else {
      const dx = Math.round(event.x - this.dragStartX)
      const dy = Math.round(event.y - this.dragStartY)
      this.floatLayer.offsetX = this.offsetBefore!.x + dx
      this.floatLayer.offsetY = this.offsetBefore!.y + dy
    }

    this.syncSelection()
    context.requestRender()
  }

  onPointerUp(_event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (this.mode === 'idle' || !this.floatLayer) { this.endDrag(); return null }

    const lift = this.liftEntry
    const moved = this.mode === 'rotate'
      ? this.angle !== this.angleAtGrab
      : this.floatLayer.offsetX !== this.offsetBefore!.x ||
        this.floatLayer.offsetY !== this.offsetBefore!.y

    // A click that changed nothing shouldn't leave a new layer behind.
    if (!moved) {
      if (lift) {
        this.abortLift(get(layerStack), lift)
        selection.set(this.selBefore)
      }
      this.endDrag()
      context.requestRender()
      return null
    }

    const entry = this.commit(lift, this.selBefore!, get(selection)!)
    this.endDrag()
    context.requestRender()
    return entry
  }

  getCursor(): string { return 'move' }

  // ---- Public API for the toolbar fields and the overlay ----------------------

  /** Shift the selection by a fixed amount. */
  nudge(dx: number, dy: number): HistoryEntry | null {
    if (dx === 0 && dy === 0) return null
    return this.applyTransform(layer => {
      layer.offsetX += dx
      layer.offsetY += dy
    })
  }

  /** Rotate the selection by a number of degrees, relative to its current angle. */
  rotateBy(degrees: number): HistoryEntry | null {
    if (!degrees) return null
    return this.applyTransform(() => {
      this.angle += (degrees * Math.PI) / 180
      this.renderFloat()
    }, true)
  }

  /** Current rotation of the floating selection, in degrees. */
  get angleDegrees(): number {
    return (this.angle * 180) / Math.PI
  }

  /**
   * Where to draw the rotation handle, in document space, along with the centre
   * it pivots around. Returns null when there's no selection to rotate.
   */
  getRotateHandle(
    sel: Selection, zoom: number
  ): { hx: number; hy: number; cx: number; cy: number } | null {
    let cx: number, cy: number, reach: number, theta: number
    if (this.hasFloat()) {
      cx = this.centerX + (this.floatLayer!.offsetX - this.baseOffsetX)
      cy = this.centerY + (this.floatLayer!.offsetY - this.baseOffsetY)
      reach = this.contentH / 2
      theta = this.angle
    } else {
      const b = selectionBounds(sel)
      if (b.w <= 0 || b.h <= 0) return null
      cx = b.x + b.w / 2
      cy = b.y + b.h / 2
      reach = b.h / 2
      theta = 0
    }
    const dist = reach + HANDLE_GAP_PX / Math.max(zoom, 0.01)
    return {
      hx: cx + dist * Math.sin(theta),
      hy: cy - dist * Math.cos(theta),
      cx,
      cy,
    }
  }

  /** Forget the float without disturbing the layer stack. See `invalidateFloatingSelection`. */
  dropFloat(): void {
    this.floatLayer  = null
    this.sourceLayer = null
    this.floatSel    = null
    this.floatBase   = null
    this.pristine    = null
    this.rotCache    = null
    this.angle       = 0
    this.mode        = 'idle'
  }

  /** True while a floating selection exists and is still the active layer. */
  hasFloat(): boolean {
    const f = this.floatLayer
    if (!f) return false
    const ls = get(layerStack)
    return ls.active === f && ls.layers.includes(f)
  }

  // ---- internals -------------------------------------------------------------

  /** Run a transform on the float (creating it if needed) and build its entry. */
  private applyTransform(mutate: (layer: Layer) => void, pixels = false): HistoryEntry | null {
    const sel = get(selection)
    if (!sel) return null
    const ls   = get(layerStack)
    const mask = SelectionMask.from(sel, ls.width, ls.height)
    if (!mask) return null

    const { layer, lift } = this.ensureFloat(ls, sel, mask)
    this.offsetBefore = { x: layer.offsetX, y: layer.offsetY }
    this.pixelsBefore = pixels && !lift ? this.captureFloat() : null

    mutate(layer)
    this.syncSelection()
    return this.commit(lift, sel, get(selection)!)
  }

  private pointerAngle(x: number, y: number): number {
    const cx = this.centerX + (this.floatLayer!.offsetX - this.baseOffsetX)
    const cy = this.centerY + (this.floatLayer!.offsetY - this.baseOffsetY)
    return Math.atan2(y - cy, x - cx)
  }

  /** Redraw the float from the pristine pixels at the current angle. */
  private renderFloat(): void {
    const layer = this.floatLayer
    if (!layer || !this.pristine) return
    const d = layer.canvas.width
    const ctx = layer.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, d, d)
    ctx.translate(d / 2, d / 2)
    ctx.rotate(this.angle)
    ctx.drawImage(this.pristine, -this.contentW / 2, -this.contentH / 2)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.markDirty()
  }

  /** Recompute the visible selection from the base shape, angle and offset. */
  private syncSelection(): void {
    if (!this.floatBase || !this.floatLayer) return
    if (!this.rotCache || this.rotCache.angle !== this.angle) {
      this.rotCache = {
        angle: this.angle,
        shape: rotateSelectionShape(this.floatBase, this.centerX, this.centerY, this.angle),
      }
    }
    const rotated = this.rotCache.shape
    const next = translateSelection(
      rotated,
      this.floatLayer.offsetX - this.baseOffsetX,
      this.floatLayer.offsetY - this.baseOffsetY
    )
    selection.set(next)
    this.floatSel = next
  }

  private captureFloat(): ArrayBuffer {
    const c = this.floatLayer!.canvas
    return this.floatLayer!.ctx.getImageData(0, 0, c.width, c.height).data.buffer.slice(0)
  }

  /**
   * Return the layer the selected pixels live on, creating it (and punching
   * them out of the source) the first time. `lift` is non-null only when this
   * call created the float.
   */
  private ensureFloat(
    ls: LayerStack, sel: Selection, mask: SelectionMask
  ): { layer: Layer; lift: HistoryEntry | null } {
    if (this.hasFloat() && this.floatSel === sel) {
      return { layer: this.floatLayer!, lift: null }
    }

    const source = ls.active

    // Region of the source layer that loses pixels, in layer-local coords.
    const sx0 = Math.max(0, mask.x - source.offsetX)
    const sy0 = Math.max(0, mask.y - source.offsetY)
    const sx1 = Math.min(source.canvas.width,  mask.x - source.offsetX + mask.w)
    const sy1 = Math.min(source.canvas.height, mask.y - source.offsetY + mask.h)
    const sw = Math.max(0, sx1 - sx0), sh = Math.max(0, sy1 - sy0)
    const hasSourceRect = sw > 0 && sh > 0

    const beforePixels = hasSourceRect
      ? source.ctx.getImageData(sx0, sy0, sw, sh).data.buffer.slice(0)
      : new ArrayBuffer(0)

    this.pristine = liftSelection(source, mask)
    this.contentW = mask.w
    this.contentH = mask.h
    punchSelection(source, mask)

    // Square canvas with room for the content at any angle, so rotated corners
    // are never clipped. The content sits dead centre and the layer offset
    // places it back where it was lifted from.
    const d = Math.ceil(Math.hypot(mask.w, mask.h)) + 2
    const float = ls.add(FLOAT_LAYER_NAME, d, d)
    float.offsetX = Math.round(mask.x - (d - mask.w) / 2)
    float.offsetY = Math.round(mask.y - (d - mask.h) / 2)

    this.floatLayer  = float
    this.sourceLayer = source
    this.floatBase   = sel
    this.floatSel    = sel
    this.angle       = 0
    this.centerX     = mask.x + mask.w / 2
    this.centerY     = mask.y + mask.h / 2
    this.baseOffsetX = float.offsetX
    this.baseOffsetY = float.offsetY
    this.rotCache    = null
    liveFloat        = this
    this.renderFloat()

    const lift: HistoryEntry = {
      description: 'Move Selection',
      layerId: source.id,
      dirtyRect: { x: sx0, y: sy0, w: sw, h: sh },
      beforePixels,
      afterPixels: hasSourceRect
        ? source.ctx.getImageData(sx0, sy0, sw, sh).data.buffer.slice(0)
        : new ArrayBuffer(0),
      extra: {
        layerId: float.id,
        dirtyRect: { x: 0, y: 0, w: d, h: d },
        // The float layer was blank a moment ago.
        beforePixels: new ArrayBuffer(d * d * 4),
        afterPixels: new ArrayBuffer(0),   // filled in at commit
      },
    }

    bump()
    return { layer: float, lift }
  }

  /** Build the history entry for a finished transform. */
  private commit(lift: HistoryEntry | null, selBefore: Selection, selAfter: Selection): HistoryEntry {
    const float = this.floatLayer!
    const offsetAfter = { x: float.offsetX, y: float.offsetY }

    if (lift) {
      // Fold the whole thing — hole, float contents, final placement — into one
      // entry so it undoes as a single step.
      lift.extra!.afterPixels  = this.captureFloat()
      lift.extra!.offsetBefore = { x: this.baseOffsetX, y: this.baseOffsetY }
      lift.extra!.offsetAfter  = offsetAfter
      lift.selectionBefore = selBefore
      lift.selectionAfter  = selAfter
      return lift
    }

    const d = float.canvas.width
    return {
      description: 'Move Selection',
      layerId: float.id,
      dirtyRect: this.pixelsBefore ? { x: 0, y: 0, w: d, h: d } : { x: 0, y: 0, w: 0, h: 0 },
      beforePixels: this.pixelsBefore ?? new ArrayBuffer(0),
      afterPixels:  this.pixelsBefore ? this.captureFloat() : new ArrayBuffer(0),
      selectionBefore: selBefore,
      selectionAfter:  selAfter,
      offsetBefore: this.offsetBefore ?? offsetAfter,
      offsetAfter,
    }
  }

  /** Undo a lift that turned out to be a stray click. */
  private abortLift(ls: LayerStack, lift: HistoryEntry): void {
    const source = this.sourceLayer
    if (source && lift.beforePixels.byteLength > 0) {
      const { x, y, w, h } = lift.dirtyRect
      source.putImageData(new ImageData(new Uint8ClampedArray(lift.beforePixels), w, h), x, y)
    }
    if (this.floatLayer) {
      ls.remove(this.floatLayer.id)
      if (source) ls.setActive(source.id)
    }
    this.dropFloat()
    liveFloat = null
    bump()
  }

  private endDrag(): void {
    this.mode         = 'idle'
    this.offsetBefore = null
    this.pixelsBefore = null
    this.selBefore    = null
    this.liftEntry    = null
  }
}

// ---- Shared helpers ----------------------------------------------------------

/** Copy the selected pixels out of a layer into a canvas the size of the mask. */
export function liftSelection(layer: Layer, mask: SelectionMask): OffscreenCanvas {
  const out = new OffscreenCanvas(mask.w, mask.h)
  const ctx = out.getContext('2d')!
  // Work in document space so the mask lines up; the layer sits at its offset.
  ctx.setTransform(1, 0, 0, 1, -mask.x, -mask.y)
  ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
  mask.clip(ctx, mask.x, mask.y, mask.w, mask.h)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return out
}

/** Erase the selected pixels from a layer, leaving transparency behind. */
export function punchSelection(layer: Layer, mask: SelectionMask): void {
  const ctx = layer.ctx
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, -layer.offsetX, -layer.offsetY)
  mask.punch(ctx)
  ctx.restore()
  layer.markDirty()
}

/** Shift a selection of any type by (dx, dy). */
export function translateSelection(sel: Selection, dx: number, dy: number): Selection {
  if (dx === 0 && dy === 0) return sel
  if (sel.type === 'rect') return { ...sel, x: sel.x + dx, y: sel.y + dy }
  if (sel.type === 'mask') return { ...sel, x: sel.x + dx, y: sel.y + dy }
  return { type: 'lasso', points: sel.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
}
