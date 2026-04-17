import type { Layer } from '../layer'
import type { HistoryEntry } from '../history-manager'
export type { HistoryEntry }

export interface ToolEvent {
  x: number
  y: number
  pressure: number  // 0–1; mouse always 1
  altKey: boolean
  shiftKey: boolean
}

export interface ToolContext {
  activeLayer: Layer
  strokeCanvas: OffscreenCanvas
  strokeCtx: OffscreenCanvasRenderingContext2D
  canvasWidth: number
  canvasHeight: number
  requestRender(): void
}


export interface Tool {
  onPointerDown(event: ToolEvent, context: ToolContext): void
  onPointerMove(event: ToolEvent, context: ToolContext): void
  // Returns a HistoryEntry to commit, or null if nothing changed.
  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null
  onRightClick?(event: ToolEvent, context: ToolContext): void
  /** Set to true if onRightClick begins a drag stroke (move/up will be forwarded). */
  onRightClickDrags?: boolean
  getCursor(): string
}
