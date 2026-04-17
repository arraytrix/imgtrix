export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'

let nextId = 1

export class Layer {
  readonly id: string
  name: string
  blendMode: BlendMode = 'normal'
  opacity = 1
  visible = true
  offsetX = 0
  offsetY = 0
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D

  // Set whenever pixel content changes; WebGLCompositor reads and resets this
  gpuDirty = true
  // Set when any painting/content change occurs; never reset (used for delete confirmation)
  modified = false

  markDirty(): void { this.gpuDirty = true; this.modified = true }

  constructor(width: number, height: number, name?: string) {
    this.id = `layer_${nextId++}`
    this.name = name ?? `Layer ${nextId - 1}`
    this.canvas = new OffscreenCanvas(width, height)
    this.ctx = this.canvas.getContext('2d')!
  }

  getImageData(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
  }

  putImageData(data: ImageData, x = 0, y = 0): void {
    this.ctx.putImageData(data, x, y)
    this.gpuDirty = true
    this.modified = true
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.gpuDirty = true
  }

  resize(newWidth: number, newHeight: number): void {
    const newCanvas = new OffscreenCanvas(newWidth, newHeight)
    const newCtx = newCanvas.getContext('2d')!
    newCtx.drawImage(this.canvas, 0, 0)
    this.canvas = newCanvas
    this.ctx = newCtx
    this.gpuDirty = true
  }

  rotate(degrees: 90 | 180 | 270): void {
    const W = this.canvas.width
    const H = this.canvas.height
    const swap = degrees === 90 || degrees === 270
    const newW = swap ? H : W
    const newH = swap ? W : H
    const newCanvas = new OffscreenCanvas(newW, newH)
    const newCtx = newCanvas.getContext('2d')!
    newCtx.translate(newW / 2, newH / 2)
    newCtx.rotate((degrees * Math.PI) / 180)
    newCtx.drawImage(this.canvas, -W / 2, -H / 2)
    newCtx.resetTransform()
    this.canvas = newCanvas
    this.ctx = newCtx
    this.gpuDirty = true
  }
}
