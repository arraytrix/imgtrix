import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'

export class MoveLayerTool implements Tool {
  private isDragging    = false
  private dragStartX    = 0
  private dragStartY    = 0
  private offsetBefore: { x: number; y: number } | null = null
  private layerId       = ''

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.dragStartX   = event.x
    this.dragStartY   = event.y
    this.offsetBefore = { x: context.activeLayer.offsetX, y: context.activeLayer.offsetY }
    this.layerId      = context.activeLayer.id
    this.isDragging   = true
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    if (!this.isDragging || !this.offsetBefore) return
    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)
    context.activeLayer.offsetX = this.offsetBefore.x + dx
    context.activeLayer.offsetY = this.offsetBefore.y + dy
    context.requestRender()
  }

  onPointerUp(event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.isDragging || !this.offsetBefore) { this.reset(); return null }

    const dx = Math.round(event.x - this.dragStartX)
    const dy = Math.round(event.y - this.dragStartY)
    if (dx === 0 && dy === 0) { this.reset(); return null }

    const entry: HistoryEntry = {
      description:  'Move Layer',
      layerId:      this.layerId,
      dirtyRect:    { x: 0, y: 0, w: context.canvasWidth, h: context.canvasHeight },
      beforePixels: new ArrayBuffer(0),
      afterPixels:  new ArrayBuffer(0),
      offsetBefore: this.offsetBefore,
      offsetAfter:  { x: context.activeLayer.offsetX, y: context.activeLayer.offsetY },
    }
    this.reset()
    return entry
  }

  getCursor(): string { return 'grab' }

  private reset(): void {
    this.isDragging   = false
    this.offsetBefore = null
    this.layerId      = ''
  }
}
