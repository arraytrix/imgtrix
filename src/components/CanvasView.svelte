<script lang="ts">
  import { onMount } from 'svelte'
  import {
    layerStack, historyManager, compositor, toolManager,
    bump, viewport, zoomPct, menuAction, activeToolName, selection, markCurrentTabDirty
  } from '../store'
  import type { HistoryEntry } from '../engine/tools/tool'
  import type { CloneTool } from '../engine/tools/clone'

  let canvas: HTMLCanvasElement
  let overlayCanvas: HTMLCanvasElement
  let container: HTMLDivElement
  let animFrameId: number
  let dirty = false

  // Cached bounding rect — invalidated whenever the container resizes.
  // Avoids a forced layout reflow on every pointer-move / wheel event.
  let canvasRect: DOMRect | null = null
  function getCanvasRect(): DOMRect { return (canvasRect ??= canvas.getBoundingClientRect()) }

  // Pan state
  let isPanning = false
  let spaceDown = false
  let panStartX = 0, panStartY = 0
  let panStartOffsetX = 0, panStartOffsetY = 0

  // Drawing state (tracked here so pan and draw don't conflict)
  let isDrawing = false

  // Cursor position in screen space (for brush preview overlay)
  let cursorX = 0, cursorY = 0
  let cursorVisible = false

  // Cached offscreen canvases for the clone-brush hover preview.
  // Reused every frame to avoid allocating dab/mask textures on each redraw.
  let clonePreviewDab:  OffscreenCanvas | null = null
  let clonePreviewMask: OffscreenCanvas | null = null

  function requestRender(): void { dirty = true }

  function renderLoop(): void {
    if (dirty) {
      compositor.composite($layerStack, toolManager.strokeCanvas, toolManager.strokeOpacity, canvas, viewport)
      dirty = false
    }
    drawOverlay()
    animFrameId = requestAnimationFrame(renderLoop)
  }

  function drawOverlay(): void {
    if (!overlayCanvas) return
    const ctx = overlayCanvas.getContext('2d')!
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

    // Clone hover preview — drawn first so the brush-circle outline below
    // overlays it on top. Only when a target is set and we're not mid-stroke.
    if ($activeToolName === 'clone' && cursorVisible && !isDrawing) {
      const tool = toolManager.activeTool as CloneTool
      if (tool.sourcePoint) drawClonePreview(ctx, cursorX, cursorY, tool)
    }

    // Brush size preview at cursor (skip for selection tools, move tools, and eyedropper — they have their own cursors)
    if (cursorVisible && !isSelectTool && $activeToolName !== 'eyedropper' && $activeToolName !== 'move' && $activeToolName !== 'move-layer') {
      const t = toolManager.activeTool as Record<string, unknown>
      const brushSize = typeof t['size'] === 'number' ? t['size'] : 20
      const r = Math.max(2, (brushSize / 2) * viewport.zoom)
      drawBrushPreview(ctx, cursorX, cursorY, r)
    }

    // Eyedropper cursor: sample-region box + crosshair + center dot
    if (cursorVisible && $activeToolName === 'eyedropper') {
      const t = toolManager.activeTool as Record<string, unknown>
      const sampleSize = typeof t['sampleSize'] === 'number' ? t['sampleSize'] : 1
      drawEyedropperCursor(ctx, cursorX, cursorY, sampleSize)
    }

    // Marching ants selection
    if ($selection) {
      if ($selection.type === 'rect') {
        const { x, y, w, h } = $selection
        const sx = x * viewport.zoom + viewport.offsetX
        const sy = y * viewport.zoom + viewport.offsetY
        drawMarchingAntsRect(ctx, sx, sy, w * viewport.zoom, h * viewport.zoom)
      } else if ($selection.type === 'lasso') {
        drawMarchingAntsLasso(ctx, $selection.points)
      } else {
        drawMarchingAntsMask(ctx, $selection)
      }
    }

    if ($activeToolName !== 'clone') return

    const tool = toolManager.activeTool as CloneTool
    const r    = (tool.size / 2) * viewport.zoom

    // Source crosshair: in trace mode with offset locked, follow cursor so user
    // can see what is actually being sampled; otherwise show the fixed source point.
    if (tool.trace && tool.traceOffset && cursorVisible) {
      const docX = (cursorX - viewport.offsetX) / viewport.zoom
      const docY = (cursorY - viewport.offsetY) / viewport.zoom
      const sx = (docX + tool.traceOffset.x) * viewport.zoom + viewport.offsetX
      const sy = (docY + tool.traceOffset.y) * viewport.zoom + viewport.offsetY
      drawCrosshair(ctx, sx, sy, r, false)
    } else if (tool.sourcePoint) {
      const sx = tool.sourcePoint.x * viewport.zoom + viewport.offsetX
      const sy = tool.sourcePoint.y * viewport.zoom + viewport.offsetY
      drawCrosshair(ctx, sx, sy, r, false)
    }

    if (tool.currentSourcePos) {
      const cx = tool.currentSourcePos.x * viewport.zoom + viewport.offsetX
      const cy = tool.currentSourcePos.y * viewport.zoom + viewport.offsetY
      drawCrosshair(ctx, cx, cy, r, true)
    }
  }

  function drawClonePreview(
    ctx: CanvasRenderingContext2D,
    screenX: number, screenY: number,
    tool: CloneTool,
  ): void {
    // Project source position in document space.
    // Trace mode locks an offset on the first stroke; before that (and in
    // non-trace mode) the first dab samples directly from the target point,
    // so we preview that — what you'd deposit if you clicked right now.
    const docX = (screenX - viewport.offsetX) / viewport.zoom
    const docY = (screenY - viewport.offsetY) / viewport.zoom
    let srcX: number, srcY: number
    if (tool.trace && tool.traceOffset) {
      srcX = docX + tool.traceOffset.x
      srcY = docY + tool.traceOffset.y
    } else {
      srcX = tool.sourcePoint!.x
      srcY = tool.sourcePoint!.y
    }

    const r = tool.size / 2
    const d = Math.max(1, Math.ceil(r * 2))

    // (Re)allocate cached canvases when brush size changes
    if (!clonePreviewDab || clonePreviewDab.width !== d) {
      clonePreviewDab  = new OffscreenCanvas(d, d)
      clonePreviewMask = new OffscreenCanvas(d, d)
    }
    const dab     = clonePreviewDab!
    const dabCtx  = dab.getContext('2d')!
    const mask    = clonePreviewMask!
    const maskCtx = mask.getContext('2d')!

    // Sample from the active layer (matches CloneTool.drawDab's sampleCanvas behaviour:
    // doc-space coords used directly as layer-canvas coords).
    const layer = $layerStack.active
    dabCtx.clearRect(0, 0, d, d)
    dabCtx.drawImage(layer.canvas, srcX - r, srcY - r, d, d, 0, 0, d, d)

    // Hardness mask, identical to the real dab path
    maskCtx.clearRect(0, 0, d, d)
    maskCtx.beginPath()
    maskCtx.arc(r, r, r, 0, Math.PI * 2)
    if (tool.hardness >= 1) {
      maskCtx.fillStyle = 'rgba(0,0,0,1)'
    } else {
      const innerR = Math.max(0, tool.hardness * r - 0.5)
      const grad = maskCtx.createRadialGradient(r, r, innerR, r, r, r)
      grad.addColorStop(0, 'rgba(0,0,0,1)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      maskCtx.fillStyle = grad
    }
    maskCtx.fill()

    dabCtx.save()
    dabCtx.globalCompositeOperation = 'destination-in'
    dabCtx.drawImage(mask, 0, 0)
    dabCtx.restore()

    // Composite onto the overlay with rotation / thickness / softness, in screen space
    const screenR = r * viewport.zoom
    ctx.save()
    ctx.globalAlpha = 0.85
    if (tool.softness > 0.01) {
      ctx.filter = `blur(${(tool.softness * screenR * 0.5).toFixed(1)}px)`
    }
    ctx.translate(screenX, screenY)
    if (tool.rotation !== 0) ctx.rotate(tool.rotation * Math.PI / 180)
    if (tool.thickness < 1) ctx.scale(1, Math.max(0.01, tool.thickness))
    ctx.drawImage(dab, -screenR, -screenR, screenR * 2, screenR * 2)
    ctx.restore()
  }

  function drawBrushPreview(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    for (const [lw, color] of [[2, 'rgba(0,0,0,0.7)'], [1, 'rgba(255,255,255,0.9)']] as [number, string][]) {
      ctx.save()
      ctx.lineWidth = lw as number
      ctx.strokeStyle = color as string
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  function drawEyedropperCursor(ctx: CanvasRenderingContext2D, x: number, y: number, sampleSize: number): void {
    // Sample-region box when sampling more than one pixel
    if (sampleSize > 1) {
      const halfScreen = (sampleSize / 2) * viewport.zoom
      for (const [lw, color] of [[2, 'rgba(0,0,0,0.7)'], [1, 'rgba(255,255,255,0.85)']] as [number, string][]) {
        ctx.save()
        ctx.lineWidth = lw as number
        ctx.strokeStyle = color as string
        ctx.setLineDash([3, 2])
        ctx.strokeRect(x - halfScreen, y - halfScreen, sampleSize * viewport.zoom, sampleSize * viewport.zoom)
        ctx.restore()
      }
    }

    // Crosshair arms
    const arm = 7
    const gap = 3  // gap around center dot so lines don't overlap it
    for (const [lw, color] of [[2, 'rgba(0,0,0,0.75)'], [1, 'rgba(255,255,255,0.95)']] as [number, string][]) {
      ctx.save()
      ctx.lineWidth = lw as number
      ctx.strokeStyle = color as string
      ctx.beginPath()
      ctx.moveTo(x - arm, y); ctx.lineTo(x - gap, y)  // left
      ctx.moveTo(x + gap, y); ctx.lineTo(x + arm, y)  // right
      ctx.moveTo(x, y - arm); ctx.lineTo(x, y - gap)  // up
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + arm)  // down
      ctx.stroke()
      ctx.restore()
    }

    // Center dot
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, 2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  function marchingAntsStyle(ctx: CanvasRenderingContext2D): number {
    const t = performance.now() / 80
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    return -(t % 10)  // base offset; caller adds 5 for the white layer
  }

  function drawMarchingAntsRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save()
    const base = marchingAntsStyle(ctx)
    for (const [color, extra] of [['rgba(0,0,0,0.85)', 0], ['rgba(255,255,255,0.85)', 5]] as [string, number][]) {
      ctx.strokeStyle    = color
      ctx.lineDashOffset = base + extra
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
    }
    ctx.restore()
  }

  function drawMarchingAntsMask(
    ctx: CanvasRenderingContext2D,
    mask: { type: 'mask'; x: number; y: number; w: number; h: number; data: Uint8Array }
  ): void {
    const { x: mx, y: my, w: mw, h: mh, data } = mask
    const zoom   = viewport.zoom
    const ox     = viewport.offsetX
    const oy     = viewport.offsetY
    const stride = Math.max(1, Math.round(1 / zoom))

    // Merge consecutive collinear edge pixels into runs so the dashed pattern
    // flows smoothly instead of each 1px segment independently strobing.
    type Seg = [number, number, number, number]  // x0,y0,x1,y1 in doc space
    const hSegs: Seg[] = []
    const vSegs: Seg[] = []

    // Horizontal runs: scan each boundary row
    for (let row = 0; row <= mh; row += stride) {
      let runStart = -1
      for (let col = 0; col <= mw; col += stride) {
        const isEdge = col < mw && (
          (row > 0  ? data[(row - 1) * mw + col] : 0) !==
          (row < mh ? data[row       * mw + col] : 0)
        )
        if (isEdge && runStart < 0) {
          runStart = col
        } else if (!isEdge && runStart >= 0) {
          hSegs.push([runStart, row, col, row])
          runStart = -1
        }
      }
      if (runStart >= 0) hSegs.push([runStart, row, mw, row])
    }

    // Vertical runs: scan each boundary column
    for (let col = 0; col <= mw; col += stride) {
      let runStart = -1
      for (let row = 0; row <= mh; row += stride) {
        const isEdge = row < mh && (
          (col > 0  ? data[row * mw + col - 1] : 0) !==
          (col < mw ? data[row * mw + col]     : 0)
        )
        if (isEdge && runStart < 0) {
          runStart = row
        } else if (!isEdge && runStart >= 0) {
          vSegs.push([col, runStart, col, row])
          runStart = -1
        }
      }
      if (runStart >= 0) vSegs.push([col, runStart, col, mh])
    }

    ctx.save()
    const base = marchingAntsStyle(ctx)

    for (const [color, extra] of [['rgba(0,0,0,0.85)', 0], ['rgba(255,255,255,0.85)', 5]] as [string, number][]) {
      ctx.strokeStyle    = color
      ctx.lineDashOffset = base + (extra as number)
      ctx.beginPath()
      for (const [x0, y0, x1, y1] of hSegs) {
        ctx.moveTo((mx + x0) * zoom + ox, (my + y0) * zoom + oy)
        ctx.lineTo((mx + x1) * zoom + ox, (my + y1) * zoom + oy)
      }
      for (const [x0, y0, x1, y1] of vSegs) {
        ctx.moveTo((mx + x0) * zoom + ox, (my + y0) * zoom + oy)
        ctx.lineTo((mx + x1) * zoom + ox, (my + y1) * zoom + oy)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawMarchingAntsLasso(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
    if (points.length < 2) return
    ctx.save()
    const base = marchingAntsStyle(ctx)
    for (const [color, extra] of [['rgba(0,0,0,0.85)', 0], ['rgba(255,255,255,0.85)', 5]] as [string, number][]) {
      ctx.strokeStyle    = color
      ctx.lineDashOffset = base + extra
      ctx.beginPath()
      const p0 = points[0]
      ctx.moveTo(p0.x * viewport.zoom + viewport.offsetX, p0.y * viewport.zoom + viewport.offsetY)
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        ctx.lineTo(p.x * viewport.zoom + viewport.offsetX, p.y * viewport.zoom + viewport.offsetY)
      }
      ctx.closePath()
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number,
    dashed: boolean
  ): void {
    const arm  = r + 8
    const dash = dashed ? [5, 4] : []
    for (const [lw, color] of [[3, 'rgba(0,0,0,0.55)'], [1.5, 'white']] as [number, string][]) {
      ctx.save()
      ctx.lineWidth   = lw
      ctx.strokeStyle = color
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y)
      ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm)
      ctx.stroke()
      ctx.restore()
    }
  }

  // Convert screen coordinates (relative to canvas element) to document space
  function screenToDoc(clientX: number, clientY: number) {
    const rect = getCanvasRect()
    return {
      x: (clientX - rect.left - viewport.offsetX) / viewport.zoom,
      y: (clientY - rect.top  - viewport.offsetY) / viewport.zoom
    }
  }

  // Fit the document in view and center it on first load / fit-to-view shortcut
  function fitToView(): void {
    const cw = canvas.offsetWidth
    const ch = canvas.offsetHeight
    const zoom = Math.min(cw / $layerStack.width, ch / $layerStack.height) * 0.9
    viewport.zoom = zoom
    viewport.offsetX = (cw - $layerStack.width  * zoom) / 2
    viewport.offsetY = (ch - $layerStack.height * zoom) / 2
    zoomPct.set(Math.round(zoom * 100))
    requestRender()
  }

  // ---- Zoom ----------------------------------------------------------------

  function handleWheel(e: WheelEvent): void {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const newZoom = Math.max(0.05, Math.min(32, viewport.zoom * factor))
    const rect = getCanvasRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    // Keep the point under the cursor stationary
    viewport.offsetX = mx - (mx - viewport.offsetX) * (newZoom / viewport.zoom)
    viewport.offsetY = my - (my - viewport.offsetY) * (newZoom / viewport.zoom)
    viewport.zoom = newZoom
    zoomPct.set(Math.round(newZoom * 100))
    requestRender()
  }

  // ---- Pointer events ------------------------------------------------------

  let isRightDrawing = false

  function handlePointerDown(e: PointerEvent): void {
    // Move focus off any param input so the browser's native Ctrl+Z on the
    // input doesn't revert typed values when the user later presses undo.
    // Canvas isn't focusable by default, so a click here normally leaves the
    // previously-focused input still active.
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
      active.blur()
    }

    // Right click → tool right-click action (e.g. clone source, saturation reverse)
    if (e.button === 2) {
      const { x, y } = screenToDoc(e.clientX, e.clientY)
      const wantsDrag = toolManager.handleRightClick(x, y, $layerStack, requestRender)
      if (wantsDrag) {
        isRightDrawing = true
        canvas.setPointerCapture(e.pointerId)
      }
      return
    }
    // Middle mouse or Space+LMB → pan
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      panStartOffsetX = viewport.offsetX
      panStartOffsetY = viewport.offsetY
      canvas.setPointerCapture(e.pointerId)
      return
    }
    // Left mouse → draw
    if (e.button === 0) {
      isDrawing = true
      canvas.setPointerCapture(e.pointerId)
      const { x, y } = screenToDoc(e.clientX, e.clientY)
      toolManager.handlePointerDown(x, y, e.pressure || 1, e.altKey, e.shiftKey, $layerStack, $historyManager, requestRender)
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    const rect = getCanvasRect()
    cursorX = e.clientX - rect.left
    cursorY = e.clientY - rect.top
    cursorVisible = true

    if (isPanning) {
      viewport.offsetX = panStartOffsetX + (e.clientX - panStartX)
      viewport.offsetY = panStartOffsetY + (e.clientY - panStartY)
      requestRender()
      return
    }
    if (isDrawing || isRightDrawing) {
      const { x, y } = screenToDoc(e.clientX, e.clientY)
      toolManager.handlePointerMove(x, y, e.pressure || 1, e.buttons, $layerStack, $historyManager, requestRender)
    }
  }

  function handlePointerUp(e: PointerEvent): void {
    if (isPanning) {
      isPanning = false
      return
    }
    if (isRightDrawing && e.button === 2) {
      isRightDrawing = false
      const { x, y } = screenToDoc(e.clientX, e.clientY)
      toolManager.handlePointerUp(x, y, e.pressure || 1, $layerStack, $historyManager, requestRender)
      return
    }
    if (isDrawing) {
      isDrawing = false
      const { x, y } = screenToDoc(e.clientX, e.clientY)
      toolManager.handlePointerUp(x, y, e.pressure || 1, $layerStack, $historyManager, requestRender)
    }
  }

  // ---- Keyboard ------------------------------------------------------------

  function applyHistoryEntry(entry: HistoryEntry, isUndo: boolean): void {
    // Restore selection if present
    if (entry.selectionBefore !== undefined) {
      selection.set(isUndo ? entry.selectionBefore! : entry.selectionAfter!)
    }
    // Restore layer offset if present (move-tool entries)
    if (entry.offsetBefore !== undefined && entry.offsetAfter !== undefined) {
      const layer = $layerStack.layers.find(l => l.id === entry.layerId)
      if (layer) {
        const off = isUndo ? entry.offsetBefore! : entry.offsetAfter!
        layer.offsetX = off.x
        layer.offsetY = off.y
      }
    }
    // Restore pixels if present
    if (entry.beforePixels.byteLength > 0) {
      const pixels = isUndo ? entry.beforePixels : entry.afterPixels
      const layer = $layerStack.layers.find(l => l.id === entry.layerId)
      if (!layer) return
      const { x, y, w, h } = entry.dirtyRect
      layer.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), x, y)
    }
    requestRender()
    bump()
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault()
      spaceDown = true
    }
    if (e.code === 'Escape') {
      selection.set(null)
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') spaceDown = false
  }

  // ---- Lifecycle -----------------------------------------------------------

  onMount(() => {
    // Size canvas buffers to match layout size
    canvas.width = overlayCanvas.width = container.offsetWidth
    canvas.height = overlayCanvas.height = container.offsetHeight

    fitToView()

    // Keep canvas buffers in sync with container size
    const ro = new ResizeObserver(() => {
      canvas.width = overlayCanvas.width = container.offsetWidth
      canvas.height = overlayCanvas.height = container.offsetHeight
      canvasRect = null   // invalidate cached rect — layout has changed
      requestRender()
    })
    ro.observe(container)

    // Wheel must be non-passive to allow preventDefault
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    renderLoop()

    return () => {
      cancelAnimationFrame(animFrameId)
      canvas.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      ro.disconnect()
    }
  })

  $: isSelectTool = $activeToolName === 'rect-select' || $activeToolName === 'lasso-select' || $activeToolName === 'magic-wand'
  $: cursor = isPanning ? 'grabbing'
    : spaceDown ? 'grab'
    : isSelectTool ? 'crosshair'
    : $activeToolName === 'move' ? 'move'
    : $activeToolName === 'move-layer' ? 'grab'
    : 'none'

  $: if ($menuAction) {
    if ($menuAction === 'undo')     { if ($historyManager.undo(e => applyHistoryEntry(e, true)))  markCurrentTabDirty() }
    if ($menuAction === 'redo')     { if ($historyManager.redo(e => applyHistoryEntry(e, false))) markCurrentTabDirty() }
    if ($menuAction === 'fit-view') fitToView()
    if ($menuAction === 'render')   requestRender()
    menuAction.set(null)
  }
</script>

<div class="canvas-container" bind:this={container}>
  <canvas
    bind:this={canvas}
    style="cursor: {cursor}"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointerleave={(e) => { cursorVisible = false; handlePointerUp(e) }}
    on:contextmenu|preventDefault
  />
  <canvas bind:this={overlayCanvas} class="overlay" />
</div>

<style>
  .canvas-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    background: #3c3c3c;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .overlay {
    pointer-events: none;
  }
</style>
