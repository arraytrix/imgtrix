import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import type { Selection } from '../selection'
import { selection } from '../../store'

export class RectSelectTool implements Tool {
  private startX = 0
  private startY = 0
  private active = false
  private selectionBefore: Selection | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.selectionBefore = get(selection)
    this.startX = event.x
    this.startY = event.y
    this.active = true
    selection.set(null)
    context.requestRender()
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (!this.active) return
    selection.set(this.makeRect(event.x, event.y, context))
    context.requestRender()
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.active) return null
    this.active = false
    const rect = this.makeRect(event.x, event.y, context)
    const selAfter: Selection | null = rect.w < 2 || rect.h < 2 ? null : rect
    selection.set(selAfter)
    context.requestRender()
    return {
      description: 'Rect selection',
      layerId: '',
      dirtyRect: { x: 0, y: 0, w: 0, h: 0 },
      beforePixels: new ArrayBuffer(0),
      afterPixels: new ArrayBuffer(0),
      selectionBefore: this.selectionBefore,
      selectionAfter: selAfter,
    }
  }

  getCursor(): string { return 'crosshair' }

  private makeRect(x: number, y: number, context: ToolContext): Selection {
    const rx = Math.round(Math.min(this.startX, x))
    const ry = Math.round(Math.min(this.startY, y))
    const rw = Math.round(Math.abs(x - this.startX))
    const rh = Math.round(Math.abs(y - this.startY))
    const cx0 = Math.max(0, rx)
    const cy0 = Math.max(0, ry)
    const cx1 = Math.min(context.canvasWidth,  rx + rw)
    const cy1 = Math.min(context.canvasHeight, ry + rh)
    return { type: 'rect', x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 }
  }
}
