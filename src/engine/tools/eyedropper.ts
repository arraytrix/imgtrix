import { get } from 'svelte/store'
import type { Tool, ToolEvent, ToolContext, HistoryEntry } from './tool'
import { layerStack } from '../../store'

export class EyedropperTool implements Tool {
  /** Diameter of the sampling region in pixels. 1 = single pixel, 3 = 3×3 average, etc. */
  sampleSize = 1

  /** Called whenever a color is successfully sampled. Wired by App.svelte. */
  onPick: ((r: number, g: number, b: number, a: number) => void) | null = null

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    this.sample(event, context)
  }

  onPointerMove(event: ToolEvent, context: ToolContext): void {
    this.sample(event, context)
  }

  onPointerUp(_event: ToolEvent, _context: ToolContext): HistoryEntry | null {
    return null
  }

  getCursor(): string { return 'crosshair' }

  private sample(event: ToolEvent, context: ToolContext): void {
    const W  = context.canvasWidth
    const H  = context.canvasHeight
    const cx = Math.round(event.x)
    const cy = Math.round(event.y)

    // Composite all visible layers (respecting offsets) into a scratch canvas
    const offscreen = new OffscreenCanvas(W, H)
    const ctx       = offscreen.getContext('2d')!
    const ls        = get(layerStack)
    for (const layer of ls.layers) {
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha              = layer.opacity
      ctx.globalCompositeOperation = layer.blendMode === 'normal'
        ? 'source-over'
        : layer.blendMode as GlobalCompositeOperation
      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
      ctx.restore()
    }

    // Compute the sampling bounding box (clamped to canvas)
    const r  = Math.floor(this.sampleSize / 2)
    const x0 = Math.max(0, cx - r)
    const y0 = Math.max(0, cy - r)
    const x1 = Math.min(W, cx + r + 1)
    const y1 = Math.min(H, cy + r + 1)
    if (x1 <= x0 || y1 <= y0) return

    const pix   = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0
    const count = pix.length / 4
    for (let i = 0; i < pix.length; i += 4) {
      rSum += pix[i]; gSum += pix[i + 1]; bSum += pix[i + 2]; aSum += pix[i + 3]
    }

    this.onPick?.(
      Math.round(rSum / count),
      Math.round(gSum / count),
      Math.round(bSum / count),
      Math.round(aSum / count),
    )
  }
}
