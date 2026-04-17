import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Selection } from '../selection'
import { selection } from '../../store'

export class MoveTool implements Tool {
  private isDragging   = false
  private dragStartX   = 0
  private dragStartY   = 0
  private selAtStart:  Selection | null = null
  private offsetBefore: { x: number; y: number } | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const sel = get(selection)
    if (!sel) return
    if (!this.isInsideSelection(event.x, event.y, sel)) return

    this.selAtStart   = sel
    this.dragStartX   = event.x
    this.dragStartY   = event.y
    this.offsetBefore = { x: context.activeLayer.offsetX, y: context.activeLayer.offsetY }
    this.isDragging   = true
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (!this.isDragging || !this.offsetBefore) return

    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)

    context.activeLayer.offsetX = this.offsetBefore.x + dx
    context.activeLayer.offsetY = this.offsetBefore.y + dy

    selection.set(this.translateSelection(this.selAtStart!, dx, dy))
    context.requestRender()
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.isDragging || !this.offsetBefore) { this.reset(); return null }

    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)
    if (dx === 0 && dy === 0) { this.reset(); return null }

    const offsetAfter  = { x: context.activeLayer.offsetX, y: context.activeLayer.offsetY }
    const selectionAfter = get(selection)

    const entry: HistoryEntry = {
      description:     'Move',
      layerId:         context.activeLayer.id,
      dirtyRect:       { x: 0, y: 0, w: context.canvasWidth, h: context.canvasHeight },
      beforePixels:    new ArrayBuffer(0),
      afterPixels:     new ArrayBuffer(0),
      selectionBefore: this.selAtStart,
      selectionAfter,
      offsetBefore:    this.offsetBefore,
      offsetAfter,
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'move' }

  // ---- helpers ---------------------------------------------------------------

  private isInsideSelection(x: number, y: number, sel: Selection): boolean {
    if (sel.type === 'rect') {
      return x >= sel.x && x < sel.x + sel.w && y >= sel.y && y < sel.y + sel.h
    }
    if (sel.type === 'mask') {
      const col = Math.round(x) - sel.x
      const row = Math.round(y) - sel.y
      if (col < 0 || col >= sel.w || row < 0 || row >= sel.h) return false
      return sel.data[row * sel.w + col] === 1
    }
    return this.pointInLasso(x, y, sel.points)
  }

  private translateSelection(sel: Selection, dx: number, dy: number): Selection {
    if (sel.type === 'rect') return { ...sel, x: sel.x + dx, y: sel.y + dy }
    if (sel.type === 'mask') return { ...sel, x: sel.x + dx, y: sel.y + dy }
    return { type: 'lasso', points: sel.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
  }

  private pointInLasso(px: number, py: number, pts: { x: number; y: number }[]): boolean {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
        inside = !inside
    }
    return inside
  }

  private reset(): void {
    this.isDragging   = false
    this.selAtStart   = null
    this.offsetBefore = null
  }
}
