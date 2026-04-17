import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Selection } from '../selection'
import { selection } from '../../store'

const MIN_DIST = 3

export class LassoSelectTool implements Tool {
  private points: { x: number; y: number }[] = []
  private active = false
  private selectionBefore: Selection | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.selectionBefore = get(selection)
    this.points = [{ x: event.x, y: event.y }]
    this.active = true
    selection.set(null)
    context.requestRender()
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (!this.active) return
    const last = this.points[this.points.length - 1]
    if (Math.hypot(event.x - last.x, event.y - last.y) >= MIN_DIST) {
      this.points.push({ x: event.x, y: event.y })
      selection.set({ type: 'lasso', points: [...this.points] })
      context.requestRender()
    }
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.active) return null
    this.active = false
    const selAfter: Selection | null = this.points.length >= 3
      ? { type: 'lasso', points: [...this.points] }
      : null
    selection.set(selAfter)
    this.points = []
    context.requestRender()
    return {
      description: 'Lasso selection',
      layerId: '',
      dirtyRect: { x: 0, y: 0, w: 0, h: 0 },
      beforePixels: new ArrayBuffer(0),
      afterPixels: new ArrayBuffer(0),
      selectionBefore: this.selectionBefore,
      selectionAfter: selAfter,
    }
  }

  getCursor(): string { return 'crosshair' }
}
