import JSZip from 'jszip'
import { Layer } from './layer'
import type { BlendMode } from './layer'
import { LayerStack } from './layer-stack'

interface Manifest {
  version: number
  canvasWidth: number
  canvasHeight: number
  created: string
  modified: string
}

interface LayerMeta {
  id: string
  name: string
  blendMode: BlendMode
  opacity: number
  visible: boolean
  offsetX: number
  offsetY: number
}

export class FileManager {
  async saveProject(stack: LayerStack, path: string): Promise<void> {
    const zip = new JSZip()

    const manifest: Manifest = {
      version: 1,
      canvasWidth: stack.width,
      canvasHeight: stack.height,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    }
    zip.file('manifest.json', JSON.stringify(manifest))

    const layerMetas: LayerMeta[] = stack.layers.map(l => ({
      id: l.id,
      name: l.name,
      blendMode: l.blendMode,
      opacity: l.opacity,
      visible: l.visible,
      offsetX: l.offsetX,
      offsetY: l.offsetY,
    }))
    zip.file('layers.json', JSON.stringify(layerMetas))

    const folder = zip.folder('layers')!
    for (const layer of stack.layers) {
      const imageData = layer.getImageData()
      folder.file(`${layer.id}.bin`, imageData.data.buffer)
    }

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await window.api.writeFile(path, buffer)
  }

  async openProject(path: string, stack: LayerStack): Promise<void> {
    const buffer = await window.api.readFile(path)
    const zip = await JSZip.loadAsync(buffer)

    const manifestStr = await zip.file('manifest.json')!.async('string')
    const manifest: Manifest = JSON.parse(manifestStr)

    const layersStr = await zip.file('layers.json')!.async('string')
    const layerMetas: LayerMeta[] = JSON.parse(layersStr)

    stack.reset(manifest.canvasWidth, manifest.canvasHeight)
    for (const meta of layerMetas) {
      const layer = new Layer(manifest.canvasWidth, manifest.canvasHeight, meta.name)
      layer.blendMode = meta.blendMode
      layer.opacity = meta.opacity
      layer.visible = meta.visible
      layer.offsetX = meta.offsetX ?? 0
      layer.offsetY = meta.offsetY ?? 0

      const binFile = zip.file(`layers/${meta.id}.bin`)
      if (binFile) {
        const binBuffer = await binFile.async('arraybuffer')
        const imageData = new ImageData(
          new Uint8ClampedArray(binBuffer),
          manifest.canvasWidth,
          manifest.canvasHeight
        )
        layer.putImageData(imageData)
      }

      stack.layers.push(layer)
    }
  }

  async importImageAsNew(path: string): Promise<LayerStack> {
    const buffer = await window.api.readFile(path)
    const ext = path.split('.').pop()?.toLowerCase()
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }
    const mime = mimeMap[ext ?? ''] ?? 'image/png'
    const blob = new Blob([buffer], { type: mime })
    const bitmap = await createImageBitmap(blob)
    const stack = new LayerStack(bitmap.width, bitmap.height)
    stack.layers[0].name = path.split(/[\\/]/).pop() ?? 'Imported'
    stack.layers[0].ctx.drawImage(bitmap, 0, 0)
    stack.layers[0].markDirty()
    bitmap.close()
    return stack
  }

  async importImage(path: string, stack: LayerStack): Promise<void> {
    const buffer = await window.api.readFile(path)
    const ext = path.split('.').pop()?.toLowerCase()
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
    const mime = mimeMap[ext ?? ''] ?? 'image/png'
    const blob = new Blob([buffer], { type: mime })
    const bitmap = await createImageBitmap(blob)
    // Layer is native image size; offsetX/Y center it on the document.
    // The compositor accounts for layer size via u_layerScale.
    const layer = new Layer(bitmap.width, bitmap.height, path.split(/[\\/]/).pop() ?? 'Imported')
    layer.offsetX = Math.round((stack.width  - bitmap.width)  / 2)
    layer.offsetY = Math.round((stack.height - bitmap.height) / 2)
    layer.ctx.drawImage(bitmap, 0, 0)
    layer.markDirty()
    bitmap.close()
    stack.layers.push(layer)
    stack.activeIndex = stack.layers.length - 1
  }

  async exportImage(stack: LayerStack, path: string): Promise<void> {
    const offscreen = new OffscreenCanvas(stack.width, stack.height)
    const ctx = offscreen.getContext('2d')!

    for (const layer of stack.layers) {
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation =
        layer.blendMode === 'normal'
          ? 'source-over'
          : (layer.blendMode as GlobalCompositeOperation)
      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
      ctx.restore()
    }

    const ext = path.split('.').pop()?.toLowerCase()
    let mimeType = 'image/png'
    if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg'
    else if (ext === 'webp') mimeType = 'image/webp'

    const blob = await offscreen.convertToBlob({ type: mimeType })
    const buffer = await blob.arrayBuffer()
    await window.api.writeFile(path, buffer)
  }
}
