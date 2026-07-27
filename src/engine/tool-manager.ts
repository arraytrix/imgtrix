import { get } from 'svelte/store'
import type { Tool } from './tools/tool'
import type { LayerStack } from './layer-stack'
import type { HistoryManager, HistoryEntry } from './history-manager'
import type { Selection } from './selection'
import { SelectionMask } from './selection-mask'
import { selection } from '../store'
import { PencilTool } from './tools/pencil'

export class ToolManager {
  activeTool: Tool
  strokeCanvas: OffscreenCanvas
  strokeCtx: OffscreenCanvasRenderingContext2D
  private isDrawing = false

  // Rasterizing a selection isn't free, so the mask is cached and reused until
  // the selection object itself changes. Selections are always replaced (never
  // mutated in place), so identity is a sound cache key.
  private maskCache: SelectionMask | null = null
  private maskSel: Selection | null = null
  private maskW = 0
  private maskH = 0

  constructor(width: number, height: number) {
    this.strokeCanvas = new OffscreenCanvas(width, height)
    this.strokeCtx = this.strokeCanvas.getContext('2d')!
    this.activeTool = new PencilTool()
  }

  resize(width: number, height: number): void {
    this.strokeCanvas = new OffscreenCanvas(width, height)
    this.strokeCtx = this.strokeCanvas.getContext('2d')!
    this.isDrawing = false
  }

  /** Opacity the compositor should apply when drawing the strokeCanvas overlay. */
  get strokeOpacity(): number {
    const t = this.activeTool as Record<string, unknown>
    const opacity = typeof t['opacity'] === 'number' ? t['opacity'] : 1
    const speed   = typeof t['speed']   === 'number' ? t['speed']   : 100
    return opacity + (1 - opacity) * (speed / 100)
  }

  setTool(tool: Tool): void {
    this.activeTool = tool
  }

  // Coords are pre-transformed to document space (canvas coords) by the caller.
  handlePointerDown(
    x: number, y: number, pressure: number, altKey: boolean, shiftKey: boolean,
    layerStack: LayerStack,
    historyManager: HistoryManager,
    requestRender: () => void
  ): void {
    this.isDrawing = true
    this.activeTool.onPointerDown(
      { x, y, pressure, altKey, shiftKey },
      this.makeContext(layerStack, requestRender)
    )
  }

  handlePointerMove(
    x: number, y: number, pressure: number, buttons: number,
    layerStack: LayerStack,
    historyManager: HistoryManager,
    requestRender: () => void
  ): void {
    if (!this.isDrawing || !(buttons & 1)) return
    this.activeTool.onPointerMove(
      { x, y, pressure, altKey: false, shiftKey: false },
      this.makeContext(layerStack, requestRender)
    )
  }

  handlePointerUp(
    x: number, y: number, pressure: number,
    layerStack: LayerStack,
    historyManager: HistoryManager,
    requestRender: () => void
  ): void {
    if (!this.isDrawing) return
    this.isDrawing = false
    const entry = this.activeTool.onPointerUp(
      { x, y, pressure, altKey: false, shiftKey: false },
      this.makeContext(layerStack, requestRender)
    )
    if (entry) historyManager.push(entry as HistoryEntry)
  }

  /** Returns true if the tool wants to participate in a right-click drag stroke. */
  handleRightClick(
    x: number, y: number,
    layerStack: LayerStack,
    requestRender: () => void
  ): boolean {
    if (this.activeTool.onRightClick) {
      this.activeTool.onRightClick(
        { x, y, pressure: 1, altKey: false },
        this.makeContext(layerStack, requestRender)
      )
      return this.activeTool.onRightClickDrags === true
    }
    return false
  }

  private makeContext(layerStack: LayerStack, requestRender: () => void) {
    const self = this
    return {
      activeLayer: layerStack.active,
      strokeCanvas: this.strokeCanvas,
      strokeCtx: this.strokeCtx,
      canvasWidth: layerStack.width,
      canvasHeight: layerStack.height,
      // Getter so tools that don't clip (selection, move, eyedropper) never
      // trigger the rasterization.
      get selectionMask(): SelectionMask | null {
        return self.selectionMaskFor(layerStack.width, layerStack.height)
      },
      requestRender
    }
  }

  private selectionMaskFor(width: number, height: number): SelectionMask | null {
    const sel = get(selection)
    if (sel !== this.maskSel || width !== this.maskW || height !== this.maskH) {
      this.maskSel   = sel
      this.maskW     = width
      this.maskH     = height
      this.maskCache = SelectionMask.from(sel, width, height)
    }
    return this.maskCache
  }
}
