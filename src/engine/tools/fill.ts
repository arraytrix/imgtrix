import type { Tool, ToolEvent, ToolContext } from './tool'
import type { HistoryEntry } from '../history-manager'
import { extractRect } from '../history-manager'

export class FillTool implements Tool {
  color: [number, number, number, number] = [0, 0, 0, 255]
  tolerance = 32

  private beforeSnapshot: ImageData | null = null
  private didFill = false

  onPointerDown(event: ToolEvent, context: ToolContext): void {
    const layer = context.activeLayer
    const lx = Math.floor(event.x - layer.offsetX)
    const ly = Math.floor(event.y - layer.offsetY)

    if (lx < 0 || lx >= layer.canvas.width || ly < 0 || ly >= layer.canvas.height) return

    this.beforeSnapshot = layer.getImageData()
    const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    this.floodFill(imageData, lx, ly)
    layer.ctx.putImageData(imageData, 0, 0)
    layer.markDirty()
    context.requestRender()
    this.didFill = true
  }

  onPointerMove(_event: ToolEvent, _context: ToolContext): void {}

  onPointerUp(_event: ToolEvent, context: ToolContext): HistoryEntry | null {
    if (!this.beforeSnapshot || !this.didFill) {
      this.beforeSnapshot = null
      this.didFill = false
      return null
    }

    const layer = context.activeLayer
    const w = layer.canvas.width
    const h = layer.canvas.height
    const entry: HistoryEntry = {
      description: 'Fill',
      layerId: layer.id,
      dirtyRect: { x: 0, y: 0, w, h },
      beforePixels: extractRect(this.beforeSnapshot, 0, 0, w, h),
      afterPixels:  layer.ctx.getImageData(0, 0, w, h).data.buffer.slice(0),
    }
    this.beforeSnapshot = null
    this.didFill = false
    return entry
  }

  getCursor(): string { return 'crosshair' }

  private floodFill(imageData: ImageData, sx: number, sy: number): void {
    const { data, width, height } = imageData
    const startIdx = (sy * width + sx) * 4
    const tR = data[startIdx]
    const tG = data[startIdx + 1]
    const tB = data[startIdx + 2]
    const tA = data[startIdx + 3]

    const [fr, fg, fb, fa] = this.color
    // No-op if target is already the fill color
    if (tR === fr && tG === fg && tB === fb && tA === fa) return

    const tol = this.tolerance
    const matches = (i: number): boolean =>
      Math.abs(data[i]     - tR) <= tol &&
      Math.abs(data[i + 1] - tG) <= tol &&
      Math.abs(data[i + 2] - tB) <= tol &&
      Math.abs(data[i + 3] - tA) <= tol

    const visited = new Uint8Array(width * height)
    const stack: number[] = [sy * width + sx]

    while (stack.length > 0) {
      const pos = stack.pop()!
      if (visited[pos]) continue

      const y = Math.floor(pos / width)
      let x = pos % width

      // Extend left to start of matching span
      while (x > 0 && !visited[y * width + x - 1] && matches((y * width + x - 1) * 4)) x--

      let spanAbove = false
      let spanBelow = false

      while (x < width && !visited[y * width + x] && matches((y * width + x) * 4)) {
        const pixelPos = y * width + x
        visited[pixelPos] = 1
        const i = pixelPos * 4
        data[i]     = fr
        data[i + 1] = fg
        data[i + 2] = fb
        data[i + 3] = fa

        if (y > 0) {
          const above = (y - 1) * width + x
          if (!spanAbove && !visited[above] && matches(above * 4)) {
            stack.push(above)
            spanAbove = true
          } else if (spanAbove && (visited[above] || !matches(above * 4))) {
            spanAbove = false
          }
        }

        if (y < height - 1) {
          const below = (y + 1) * width + x
          if (!spanBelow && !visited[below] && matches(below * 4)) {
            stack.push(below)
            spanBelow = true
          } else if (spanBelow && (visited[below] || !matches(below * 4))) {
            spanBelow = false
          }
        }

        x++
      }
    }
  }
}
