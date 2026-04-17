import { Layer } from './layer'

export class LayerStack {
  layers: Layer[] = []     // index 0 = bottom (background), highest = top
  activeIndex = 0
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.layers.push(new Layer(width, height, 'Background'))
  }

  reset(width: number, height: number): void {
    this.width = width
    this.height = height
    this.layers = [new Layer(width, height, 'Background')]
    this.activeIndex = 0
  }

  get active(): Layer {
    return this.layers[this.activeIndex]
  }

  // Insert new layer above the active layer
  add(name?: string): Layer {
    const layer = new Layer(this.width, this.height, name)
    this.layers.splice(this.activeIndex + 1, 0, layer)
    this.activeIndex += 1
    return layer
  }

  remove(id: string): void {
    if (this.layers.length === 1) return
    const index = this.layers.findIndex(l => l.id === id)
    if (index === -1) return
    this.layers.splice(index, 1)
    this.activeIndex = Math.min(this.activeIndex, this.layers.length - 1)
  }

  // Move layer one step higher (visually up in the panel)
  moveUp(id: string): void {
    const i = this.layers.findIndex(l => l.id === id)
    if (i >= this.layers.length - 1) return
    ;[this.layers[i], this.layers[i + 1]] = [this.layers[i + 1], this.layers[i]]
    if (this.activeIndex === i) this.activeIndex++
    else if (this.activeIndex === i + 1) this.activeIndex--
  }

  // Move layer one step lower (visually down in the panel)
  moveDown(id: string): void {
    const i = this.layers.findIndex(l => l.id === id)
    if (i <= 0) return
    ;[this.layers[i], this.layers[i - 1]] = [this.layers[i - 1], this.layers[i]]
    if (this.activeIndex === i) this.activeIndex--
    else if (this.activeIndex === i - 1) this.activeIndex++
  }

  setActive(id: string): void {
    const i = this.layers.findIndex(l => l.id === id)
    if (i !== -1) this.activeIndex = i
  }

  resizeCanvas(newWidth: number, newHeight: number, offsetDx = 0, offsetDy = 0): void {
    this.width = newWidth
    this.height = newHeight
    // Shift every layer's offset so content stays at the same visual position
    for (const layer of this.layers) {
      layer.offsetX += offsetDx
      layer.offsetY += offsetDy
    }
  }

  rotateAllLayers(degrees: 90 | 180 | 270): void {
    for (const layer of this.layers) layer.rotate(degrees)
    if (degrees === 90 || degrees === 270) {
      ;[this.width, this.height] = [this.height, this.width]
    }
  }
}
