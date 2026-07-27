import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Layer } from '../layer'
import type { LayerStack } from '../layer-stack'
import type { Selection } from '../selection'
import { SelectionMask } from '../selection-mask'
import { selection, layerStack, bump } from '../../store'

export const FLOAT_LAYER_NAME = 'Floating Selection'

/**
 * Move Selection lifts the selected pixels into a layer of their own on the
 * first move — leaving one hole in the source layer — and after that just
 * shifts that layer's offset. Repeated moves are therefore non-destructive:
 * nothing under the float is ever overwritten, and dropping it in a new spot
 * costs no more pixels than the first drag did.
 *
 * The float is a normal layer, so the user commits it with Merge Down whenever
 * they're happy with the position.
 */
export class MoveTool implements Tool {
  private isDragging = false
  private dragStartX = 0
  private dragStartY = 0
  private selAtStart:   Selection | null = null
  private offsetBefore: { x: number; y: number } | null = null
  /** Entry for the lift, when this drag is the one that created the float. */
  private liftEntry: HistoryEntry | null = null

  // Float state, kept across drags
  private floatLayer:  Layer | null = null
  private sourceLayer: Layer | null = null
  /** Selection the float belongs to; identity tells us if a new one was made. */
  private floatSel: Selection | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const sel  = get(selection)
    const mask = context.selectionMask
    if (!sel || !mask) return
    if (!mask.contains(event.x, event.y)) return

    const ls = get(layerStack)
    const { layer, lift } = this.ensureFloat(ls, sel, mask)

    this.liftEntry    = lift
    this.selAtStart   = sel
    this.floatSel     = sel
    this.dragStartX   = event.x
    this.dragStartY   = event.y
    this.offsetBefore = { x: layer.offsetX, y: layer.offsetY }
    this.isDragging   = true

    if (lift) context.requestRender()
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (!this.isDragging || !this.floatLayer || !this.offsetBefore) return

    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)

    this.floatLayer.offsetX = this.offsetBefore.x + dx
    this.floatLayer.offsetY = this.offsetBefore.y + dy

    const selAfter = translateSelection(this.selAtStart!, dx, dy)
    selection.set(selAfter)
    this.floatSel = selAfter
    context.requestRender()
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.isDragging || !this.floatLayer || !this.offsetBefore) { this.endDrag(); return null }

    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)
    const lift = this.liftEntry
    this.liftEntry = null

    // A click that never moved shouldn't leave a new layer behind.
    if (dx === 0 && dy === 0) {
      if (lift) this.abortLift(get(layerStack), lift)
      selection.set(this.selAtStart)
      this.floatSel = this.selAtStart
      this.endDrag()
      context.requestRender()
      return null
    }

    const offsetAfter = { x: this.floatLayer.offsetX, y: this.floatLayer.offsetY }
    const selAfter    = translateSelection(this.selAtStart!, dx, dy)
    selection.set(selAfter)
    this.floatSel = selAfter

    const entry = this.buildEntry(this.floatLayer, lift, this.offsetBefore, offsetAfter, this.selAtStart!, selAfter)
    this.endDrag()
    context.requestRender()
    return entry
  }

  /** Shift the selection by a fixed amount — used by the toolbar X/Y fields. */
  nudge(dx: number, dy: number): HistoryEntry | null {
    if (dx === 0 && dy === 0) return null
    const sel = get(selection)
    if (!sel) return null

    const ls   = get(layerStack)
    const mask = SelectionMask.from(sel, ls.width, ls.height)
    if (!mask) return null

    const { layer, lift } = this.ensureFloat(ls, sel, mask)
    const offsetBefore = { x: layer.offsetX, y: layer.offsetY }
    layer.offsetX += dx
    layer.offsetY += dy
    const offsetAfter = { x: layer.offsetX, y: layer.offsetY }

    const selAfter = translateSelection(sel, dx, dy)
    selection.set(selAfter)
    this.floatSel = selAfter

    return this.buildEntry(layer, lift, offsetBefore, offsetAfter, sel, selAfter)
  }

  getCursor(): string { return 'move' }

  // ---- float management ------------------------------------------------------

  /**
   * Return the layer the selected pixels live on, creating it (and punching
   * them out of the source) the first time. `lift` is non-null only when this
   * call was the one that created the float.
   */
  private ensureFloat(
    ls: LayerStack, sel: Selection, mask: SelectionMask
  ): { layer: Layer; lift: HistoryEntry | null } {
    const existing = this.floatLayer
    if (existing && this.floatSel === sel && ls.active === existing && ls.layers.includes(existing)) {
      return { layer: existing, lift: null }
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

    const lifted = liftSelection(source, mask)
    punchSelection(source, mask)

    // Float layers are document-sized at offset 0, so their local coords are
    // document coords and the movement lives entirely in the offset.
    const float = ls.add(FLOAT_LAYER_NAME)
    float.ctx.drawImage(lifted, mask.x, mask.y)
    float.markDirty()

    const fx0 = Math.max(0, mask.x)
    const fy0 = Math.max(0, mask.y)
    const fw  = Math.max(0, Math.min(ls.width,  mask.x + mask.w) - fx0)
    const fh  = Math.max(0, Math.min(ls.height, mask.y + mask.h) - fy0)

    const lift: HistoryEntry = {
      description: 'Move Selection',
      layerId: source.id,
      dirtyRect: { x: sx0, y: sy0, w: sw, h: sh },
      beforePixels,
      afterPixels: hasSourceRect
        ? source.ctx.getImageData(sx0, sy0, sw, sh).data.buffer.slice(0)
        : new ArrayBuffer(0),
      extra: fw > 0 && fh > 0
        ? {
            layerId: float.id,
            dirtyRect: { x: fx0, y: fy0, w: fw, h: fh },
            // The float layer was blank a moment ago.
            beforePixels: new ArrayBuffer(fw * fh * 4),
            afterPixels:  float.ctx.getImageData(fx0, fy0, fw, fh).data.buffer.slice(0),
          }
        : { layerId: float.id },
    }

    this.floatLayer  = float
    this.sourceLayer = source
    this.floatSel    = sel
    bump()
    return { layer: float, lift }
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
    this.floatLayer  = null
    this.sourceLayer = null
    this.floatSel    = null
    bump()
  }

  private buildEntry(
    float: Layer,
    lift: HistoryEntry | null,
    offsetBefore: { x: number; y: number },
    offsetAfter:  { x: number; y: number },
    selBefore: Selection,
    selAfter:  Selection
  ): HistoryEntry {
    if (lift) {
      // Fold the movement into the lift so both undo as one step.
      lift.extra = { ...lift.extra!, offsetBefore, offsetAfter }
      lift.selectionBefore = selBefore
      lift.selectionAfter  = selAfter
      return lift
    }
    return {
      description: 'Move Selection',
      layerId: float.id,
      dirtyRect: { x: 0, y: 0, w: 0, h: 0 },
      beforePixels: new ArrayBuffer(0),
      afterPixels:  new ArrayBuffer(0),
      selectionBefore: selBefore,
      selectionAfter:  selAfter,
      offsetBefore,
      offsetAfter,
    }
  }

  private endDrag(): void {
    this.isDragging   = false
    this.selAtStart   = null
    this.offsetBefore = null
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
  if (sel.type === 'rect') return { ...sel, x: sel.x + dx, y: sel.y + dy }
  if (sel.type === 'mask') return { ...sel, x: sel.x + dx, y: sel.y + dy }
  return { type: 'lasso', points: sel.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
}
