import type { LayerStack } from './layer-stack'

const CHECKER_SIZE = 12
const CHECKER_LIGHT = '#ffffff'
const CHECKER_DARK  = '#cccccc'

// 2×2-tile source canvas for the repeating checker pattern — created once.
const checkerSource = (() => {
  const c = new OffscreenCanvas(CHECKER_SIZE * 2, CHECKER_SIZE * 2)
  const g = c.getContext('2d')!
  g.fillStyle = CHECKER_LIGHT
  g.fillRect(0, 0, CHECKER_SIZE * 2, CHECKER_SIZE * 2)
  g.fillStyle = CHECKER_DARK
  g.fillRect(0,           0,           CHECKER_SIZE, CHECKER_SIZE)
  g.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE)
  return c
})()

export class Compositor {
  private checkerPattern: CanvasPattern | null = null
  private checkerCtx: CanvasRenderingContext2D | null = null
  // CPU composite: draws layers bottom-to-top onto the display canvas.
  // The viewport transform (pan + zoom) is applied before drawing layers so
  // the display canvas acts as a viewport into the document.
  //
  // TODO (optimization): replace with WebGL compositor for large canvases.
  composite(
    stack: LayerStack,
    strokeCanvas: OffscreenCanvas | null,
    strokeOpacity: number,
    target: HTMLCanvasElement,
    vp: { offsetX: number; offsetY: number; zoom: number }
  ): void {
    const ctx = target.getContext('2d')!
    ctx.clearRect(0, 0, target.width, target.height)

    // --- Document rect in screen space ---
    const sx = vp.offsetX
    const sy = vp.offsetY
    const sw = stack.width  * vp.zoom
    const sh = stack.height * vp.zoom

    // Shadow behind the document
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 4
    ctx.fillStyle = CHECKER_LIGHT
    ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()

    // Checkerboard — drawn in screen space so check size stays constant at all zoom levels
    if (ctx !== this.checkerCtx) {
      this.checkerPattern = ctx.createPattern(checkerSource, 'repeat')
      this.checkerCtx = ctx
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()
    ctx.fillStyle = this.checkerPattern!
    ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()

    // --- Layers — drawn in document space, clipped to canvas bounds ---
    ctx.save()
    ctx.translate(vp.offsetX, vp.offsetY)
    ctx.scale(vp.zoom, vp.zoom)
    ctx.beginPath()
    ctx.rect(0, 0, stack.width, stack.height)
    ctx.clip()

    for (let i = 0; i < stack.layers.length; i++) {
      const layer = stack.layers[i]
      if (!layer.visible) continue

      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation =
        layer.blendMode === 'normal'
          ? 'source-over'
          : (layer.blendMode as GlobalCompositeOperation)

      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)

      if (i === stack.activeIndex && strokeCanvas) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = strokeOpacity
        ctx.drawImage(strokeCanvas, 0, 0)
      }

      ctx.restore()
    }

    ctx.restore()
  }
}
