<script lang="ts">
  import CanvasView from './components/CanvasView.svelte'
  import LayerPanel from './components/LayerPanel.svelte'
  import Tooltip from './components/Tooltip.svelte'
  import { get } from 'svelte/store'
  import { TOOL_KEYS } from './constants/hotkeys'
  import { toolTitle } from './constants/tool-meta'
  import { settings, loadSettings, saveSettings, resetHotkeys, updateHotkeys } from './settings-store'
  import type { HotkeySettings } from './constants/settings_defaults'
  import { PARAM_LABELS as PL, PARAM_TOOLTIPS as PT } from './constants/param-strings'
  import { HINTS, MODAL, SAT_MODE_LABELS, DODGE_MODE_LABELS, WARP_MODE_LABELS, TAB_LABELS, ADJUST_LABELS } from './constants/ui-strings'
  import { toolManager, layerStack, historyManager, bump, zoomPct, activeToolName, canvasSize, menuAction, selection, clipboard, tabs, activeTabIndex, switchTab, newTab, openInNewTab, closeTab, updateTabMeta, markCurrentTabClean, markCurrentTabDirty } from './store'
  import { LayerStack } from './engine/layer-stack'
  import { HistoryManager, extractRect } from './engine/history-manager'
  import { PencilTool } from './engine/tools/pencil'
  import { EraserTool } from './engine/tools/eraser'
  import { CloneTool } from './engine/tools/clone'
  import { WarpTool, type WarpMode } from './engine/tools/warp'
  import { BlendTool } from './engine/tools/blend'
  import { SaturationTool, type SaturationMode } from './engine/tools/saturation'
  import { DodgeBurnTool, type DodgeBurnMode } from './engine/tools/dodge-burn'
  import { RectSelectTool } from './engine/tools/rect-select'
  import { LassoSelectTool } from './engine/tools/lasso-select'
  import { MagicWandTool } from './engine/tools/magic-wand'
  import { MoveTool } from './engine/tools/move'
  import { MoveLayerTool } from './engine/tools/move-layer'
  import { EyedropperTool } from './engine/tools/eyedropper'
  import { FillTool } from './engine/tools/fill'
  import { FileManager } from './engine/file-manager'
  import { onMount, tick } from 'svelte'
  import { initTelemetry, track } from './telemetry'

  const fileManager = new FileManager()

  function dismissTelemetryNotice(): void {
    localStorage.setItem('imgtrix_telemetry_ack', '1')
    showTelemetryNotice = false
  }

  // New canvas dialog
  let showTelemetryNotice = !localStorage.getItem('imgtrix_telemetry_ack')
  let showNewDialog = false
  let newWidth = 1920
  let newHeight = 1080

  // Resize image dialog
  let showResizeImageDialog = false
  let riUnit: 'px' | '%' = 'px'
  let riW = $canvasSize.width
  let riH = $canvasSize.height
  let riConstrain = true

  function openResizeImageDialog(): void {
    riUnit = 'px'
    riW = $canvasSize.width
    riH = $canvasSize.height
    riConstrain = true
    showResizeImageDialog = true
  }

  function onRiUnit(unit: 'px' | '%'): void {
    const cw = $canvasSize.width, ch = $canvasSize.height
    if (unit === '%' && riUnit === 'px') {
      riW = Math.round(riW / cw * 100)
      riH = Math.round(riH / ch * 100)
    } else if (unit === 'px' && riUnit === '%') {
      riW = Math.round(riW / 100 * cw)
      riH = Math.round(riH / 100 * ch)
    }
    riUnit = unit
  }

  function onRiWChange(): void {
    if (!riConstrain) return
    const cw = $canvasSize.width, ch = $canvasSize.height
    if (riUnit === 'px') riH = Math.round(riW * ch / cw)
    else riH = riW
  }

  function onRiHChange(): void {
    if (!riConstrain) return
    const cw = $canvasSize.width, ch = $canvasSize.height
    if (riUnit === 'px') riW = Math.round(riH * cw / ch)
    else riW = riH
  }

  $: riNewW = riUnit === 'px' ? Math.round(riW) : Math.round($canvasSize.width  * riW / 100)
  $: riNewH = riUnit === 'px' ? Math.round(riH) : Math.round($canvasSize.height * riH / 100)
  $: riValid = riNewW >= 1 && riNewH >= 1 && riNewW <= 16384 && riNewH <= 16384

  function confirmResizeImage(): void {
    if (!riValid) return
    const ls = get(layerStack)
    const scaleX = riNewW / ls.width
    const scaleY = riNewH / ls.height

    for (const layer of ls.layers) {
      const dstW = Math.max(1, Math.round(layer.canvas.width  * scaleX))
      const dstH = Math.max(1, Math.round(layer.canvas.height * scaleY))
      const newCanvas = new OffscreenCanvas(dstW, dstH)
      const ctx = newCanvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(layer.canvas, 0, 0, dstW, dstH)
      layer.canvas = newCanvas
      layer.ctx    = ctx
      layer.offsetX = Math.round(layer.offsetX * scaleX)
      layer.offsetY = Math.round(layer.offsetY * scaleY)
    }

    ls.width  = riNewW
    ls.height = riNewH
    toolManager.resize(riNewW, riNewH)
    get(historyManager).clear()
    canvasSize.set({ width: riNewW, height: riNewH })
    showResizeImageDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Contrast dialog
  let showContrastDialog = false
  let contrastValue = 0  // -100 to +100

  function openContrastDialog(): void {
    contrastValue = 0
    showContrastDialog = true
  }

  function confirmContrast(): void {
    const ls = get(layerStack)
    const factor = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue))
    for (const layer of ls.layers) {
      const w = layer.canvas.width
      const h = layer.canvas.height
      const imageData = layer.ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        d[i]     = Math.max(0, Math.min(255, factor * (d[i]     - 128) + 128))
        d[i + 1] = Math.max(0, Math.min(255, factor * (d[i + 1] - 128) + 128))
        d[i + 2] = Math.max(0, Math.min(255, factor * (d[i + 2] - 128) + 128))
      }
      layer.ctx.putImageData(imageData, 0, 0)
    }
    showContrastDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Saturation adjustment dialog
  let showSaturationAdjustDialog = false
  let satAdjustValue = 0  // -100 to +100

  function openSaturationAdjustDialog(): void {
    satAdjustValue = 0
    showSaturationAdjustDialog = true
  }

  function confirmSaturationAdjust(): void {
    const ls = get(layerStack)
    const factor = 1 + satAdjustValue / 100
    for (const layer of ls.layers) {
      const w = layer.canvas.width
      const h = layer.canvas.height
      const imageData = layer.ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        d[i]     = Math.max(0, Math.min(255, lum + factor * (d[i]     - lum)))
        d[i + 1] = Math.max(0, Math.min(255, lum + factor * (d[i + 1] - lum)))
        d[i + 2] = Math.max(0, Math.min(255, lum + factor * (d[i + 2] - lum)))
      }
      layer.ctx.putImageData(imageData, 0, 0)
    }
    showSaturationAdjustDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Vibrancy adjustment dialog
  let showVibrancyDialog = false
  let vibrancyValue = 0  // -100 to +100

  function openVibrancyDialog(): void {
    vibrancyValue = 0
    showVibrancyDialog = true
  }

  function confirmVibrancy(): void {
    const ls = get(layerStack)
    const strength = vibrancyValue / 100
    for (const layer of ls.layers) {
      const w = layer.canvas.width
      const h = layer.canvas.height
      const imageData = layer.ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        // HSV saturation: 0 = grayscale, 1 = fully saturated
        const sat = max === 0 ? 0 : (max - min) / max
        // Muted pixels get a stronger boost; vivid pixels are barely touched
        const factor = 1 + strength * (1 - sat)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        d[i]     = Math.max(0, Math.min(255, lum + factor * (r - lum)))
        d[i + 1] = Math.max(0, Math.min(255, lum + factor * (g - lum)))
        d[i + 2] = Math.max(0, Math.min(255, lum + factor * (b - lum)))
      }
      layer.ctx.putImageData(imageData, 0, 0)
    }
    showVibrancyDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // White balance dialog
  let showWhiteBalanceDialog = false
  let wbTemperature = 0  // -100 (cool/blue) to +100 (warm/orange)
  let wbTint = 0         // -100 (green) to +100 (magenta)

  function openWhiteBalanceDialog(): void {
    wbTemperature = 0
    wbTint = 0
    showWhiteBalanceDialog = true
  }

  function confirmWhiteBalance(): void {
    const ls = get(layerStack)
    const temp = wbTemperature / 100  // -1 to +1
    const tint = wbTint / 100         // -1 to +1
    for (const layer of ls.layers) {
      const w = layer.canvas.width
      const h = layer.canvas.height
      const imageData = layer.ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        // Temperature: warm = boost R, reduce B; cool = boost B, reduce R
        // Tint: magenta = boost R+B, reduce G; green = boost G, reduce R+B
        d[i]     = Math.max(0, Math.min(255, d[i]     + temp * 40 + tint * 20))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1]             - tint * 40))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] - temp * 40 + tint * 20))
      }
      layer.ctx.putImageData(imageData, 0, 0)
    }
    showWhiteBalanceDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Merge down confirmation
  let showMergeDownConfirm = false

  // Merge all confirmation
  let showMergeAllConfirm = false

  function confirmMergeAll(): void {
    const ls = get(layerStack)
    const merged = new OffscreenCanvas(ls.width, ls.height)
    const ctx = merged.getContext('2d')!
    for (const layer of ls.layers) {
      if (!layer.visible) continue
      ctx.globalAlpha = layer.opacity ?? 1
      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
    }
    ctx.globalAlpha = 1
    const bottom = ls.layers[0]
    bottom.canvas = merged
    bottom.ctx    = ctx
    bottom.offsetX = 0
    bottom.offsetY = 0
    ls.layers = [bottom]
    ls.activeIndex = 0
    get(historyManager).clear()
    showMergeAllConfirm = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  function confirmMergeDown(): void {
    const ls = get(layerStack)
    const idx = ls.activeIndex
    const top    = ls.layers[idx]
    const bottom = ls.layers[idx - 1]
    bottom.ctx.drawImage(top.canvas, top.offsetX - bottom.offsetX, top.offsetY - bottom.offsetY)
    ls.layers.splice(idx, 1)
    ls.activeIndex = idx - 1
    get(historyManager).clear()
    showMergeDownConfirm = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Color RGB dialog
  let showColorRGBDialog = false
  let colorR = 0
  let colorG = 0
  let colorB = 0

  function openColorRGBDialog(): void {
    colorR = colorG = colorB = 0
    showColorRGBDialog = true
  }

  function confirmColorRGB(): void {
    const ls = get(layerStack)
    for (const layer of ls.layers) {
      const w = layer.canvas.width
      const h = layer.canvas.height
      const imageData = layer.ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        d[i]     = Math.max(0, Math.min(255, d[i]     + colorR * 2.55))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + colorG * 2.55))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + colorB * 2.55))
      }
      layer.ctx.putImageData(imageData, 0, 0)
    }
    showColorRGBDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  // Canvas size (resize) dialog
  let showCanvasSizeDialog = false
  let resizeTop    = 0
  let resizeBottom = 0
  let resizeLeft   = 0
  let resizeRight  = 0
  $: resizeNewW = $canvasSize.width  + resizeLeft + resizeRight
  $: resizeNewH = $canvasSize.height + resizeTop  + resizeBottom
  $: resizeValid = resizeNewW >= 1 && resizeNewH >= 1

  // Unsaved-changes dialogs
  let closeTabPending: number | null = null   // tab index awaiting close confirmation
  let appClosePending = false                 // window close pending confirmation

  let showHotkeysDialog = false
  let pendingHotkeys: HotkeySettings = { ...$settings.hotkeys }

  const hotkeyRows: Array<{ key: keyof HotkeySettings; label: string }> = [
    { key: 'paintbrush',    label: 'Paintbrush' },
    { key: 'eraser',        label: 'Eraser' },
    { key: 'clone',         label: 'Clone Stamp' },
    { key: 'warp',          label: 'Warp Brush' },
    { key: 'blend',         label: 'Blend / Smudge' },
    { key: 'saturation',    label: 'Saturation' },
    { key: 'dodgeBurn',     label: 'Lighten / Darken' },
    { key: 'rectSelect',    label: 'Rectangular Select' },
    { key: 'lasso',         label: 'Freehand Select' },
    { key: 'magicWand',     label: 'Magic Wand' },
    { key: 'move',          label: 'Move Selection' },
    { key: 'clearSelection', label: 'Clear Selection' },
    { key: 'moveLayer',     label: 'Move Layer' },
    { key: 'eyedropper',    label: 'Eyedropper' },
    { key: 'fill',          label: 'Fill' },
  ]

  function openHotkeysDialog(): void {
    pendingHotkeys = { ...$settings.hotkeys }
    showHotkeysDialog = true
  }

  function captureHotkey(key: keyof HotkeySettings, e: KeyboardEvent): void {
    const k = e.key === 'Escape' ? 'Esc' : e.key.length === 1 ? e.key.toUpperCase() : e.key
    pendingHotkeys = { ...pendingHotkeys, [key]: k }
  }

  async function confirmSaveHotkeys(): Promise<void> {
    updateHotkeys(pendingHotkeys)
    await saveSettings()
    showHotkeysDialog = false
  }

  function openNewDialog(): void { showNewDialog = true }

  function openCanvasSizeDialog(): void {
    resizeTop = resizeBottom = resizeLeft = resizeRight = 0
    showCanvasSizeDialog = true
  }

  function confirmResize(): void {
    if (!resizeValid) return
    const w = Math.min(16384, resizeNewW)
    const h = Math.min(16384, resizeNewH)
    get(layerStack).resizeCanvas(w, h, resizeLeft, resizeTop)
    toolManager.resize(w, h)
    get(historyManager).clear()
    canvasSize.set({ width: w, height: h })
    showCanvasSizeDialog = false
    markCurrentTabDirty()
    bump()
    menuAction.set('render')
  }

  function confirmNew(): void {
    const w = Math.max(1, Math.min(16384, newWidth))
    const h = Math.max(1, Math.min(16384, newHeight))
    newTab(w, h)
    showNewDialog = false
  }

  // Singleton tool instances so settings persist when switching
  const paintbrushTool = toolManager.activeTool as PencilTool
  const eraserTool = new EraserTool()
  const cloneTool  = new CloneTool()
  const warpTool      = new WarpTool()
  const blendTool       = new BlendTool()
  const saturationTool  = new SaturationTool()
  const dodgeBurnTool   = new DodgeBurnTool()
  const rectSelectTool  = new RectSelectTool()
  const lassoSelectTool = new LassoSelectTool()
  const magicWandTool   = new MagicWandTool()
  const moveTool        = new MoveTool()
  const moveLayerTool   = new MoveLayerTool()
  const eyedropperTool  = new EyedropperTool()
  const fillTool        = new FillTool()
  eyedropperTool.onPick = (r, g, b, _a) => {
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    colorHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`
    paintbrushTool.color = [r, g, b, 255]
    fillTool.color = [r, g, b, 255]
  }

  // Per-tool UI state (kept separate so params persist when switching tools)
  let colorHex = '#000000'

  let pSize = paintbrushTool.size;  let eSize = eraserTool.size;  let cSize = cloneTool.size
  let pOpacity = 100;           let eOpacity = 100;           let cOpacity = 100
  let pHardness = 100;          let eHardness = Math.round(eraserTool.hardness * 100); let cHardness = Math.round(cloneTool.hardness * 100)
  let pSoftness = 0;            let eSoftness = 0;            let cSoftness = 0
  let pRotation = 0;            let eRotation = 0;            let cRotation = 0
  let pThickness = 100;         let eThickness = 100;         let cThickness = 100
  let pFlow = 0;               let eFlow = 0;               let cFlow = 0
  let cTrace = false

  let wSize     = warpTool.size
  let wHardness = Math.round(warpTool.hardness * 100)
  let wStrength = warpTool.strength
  let wMode: WarpMode = warpTool.mode

  let bSize     = blendTool.size
  let bHardness = Math.round(blendTool.hardness * 100)
  let bStrength = blendTool.strength

  let satMode: SaturationMode = saturationTool.mode
  let satSize     = saturationTool.size
  let satHardness = Math.round(saturationTool.hardness * 100)
  let satStrength = saturationTool.strength

  let dbMode: DodgeBurnMode = dodgeBurnTool.mode
  let dbSize     = dodgeBurnTool.size
  let dbHardness = Math.round(dodgeBurnTool.hardness * 100)
  let dbStrength = dodgeBurnTool.strength

  $: window.api.notifySelectionChanged(!!$selection)
  $: window.api.notifyClipboardChanged(!!$clipboard)

  $: isPaintbrush      = $activeToolName === 'paintbrush'
  $: isClone       = $activeToolName === 'clone'
  $: isWarp        = $activeToolName === 'warp'
  $: isBlend       = $activeToolName === 'blend'
  $: isSaturation  = $activeToolName === 'saturation'
  $: isDodgeBurn   = $activeToolName === 'dodge-burn'
  $: isMagicWand   = $activeToolName === 'magic-wand'
  $: isMove        = $activeToolName === 'move'
  $: isMoveLayer    = $activeToolName === 'move-layer'
  $: isEyedropper   = $activeToolName === 'eyedropper'
  $: isFill         = $activeToolName === 'fill'
  $: isSelect      = $activeToolName === 'rect-select' || $activeToolName === 'lasso-select'

  let mwThreshold = magicWandTool.threshold
  let moveLayerDX = 0; let moveLayerDY = 0
  let moveSelDX   = 0; let moveSelDY   = 0
  $: size      = isPaintbrush ? pSize     : isClone ? cSize     : eSize
  $: opacity   = isPaintbrush ? pOpacity  : isClone ? cOpacity  : eOpacity
  $: hardness  = isPaintbrush ? pHardness : isClone ? cHardness : eHardness
  $: softness  = isPaintbrush ? pSoftness : isClone ? cSoftness : eSoftness
  $: rotation  = isPaintbrush ? pRotation : isClone ? cRotation : eRotation
  $: thickness = isPaintbrush ? pThickness : isClone ? cThickness : eThickness
  $: flow      = isPaintbrush ? pFlow    : isClone ? cFlow    : eFlow

  function applyParams(): void {
    const tool = isPaintbrush ? paintbrushTool : isClone ? cloneTool : eraserTool
    const t = tool as Record<string, unknown>
    t['size']    = isPaintbrush ? pSize    : isClone ? cSize    : eSize
    t['opacity'] = (isPaintbrush ? pOpacity : isClone ? cOpacity : eOpacity) / 100
    t['hardness'] = (isPaintbrush ? pHardness : isClone ? cHardness : eHardness) / 100
    t['softness'] = (isPaintbrush ? pSoftness : isClone ? cSoftness : eSoftness) / 100
    t['flow']    = isPaintbrush ? pFlow   : isClone ? cFlow   : eFlow
    t['rotation'] = isPaintbrush ? pRotation : isClone ? cRotation : eRotation
    t['thickness'] = (isPaintbrush ? pThickness : isClone ? cThickness : eThickness) / 100
    if (isClone) t['trace'] = cTrace
  }

  const PARAM_RANGE: Record<string, [number, number]> = {
    size: [1, 500], opacity: [1, 100], hardness: [0, 100],
    softness: [0, 100], rotation: [0, 359], thickness: [1, 100], flow: [0, 100],
  }

  function onParam(param: 'size'|'opacity'|'hardness'|'softness'|'rotation'|'thickness'|'flow', e: Event): void {
    const [lo, hi] = PARAM_RANGE[param]
    const v = Math.max(lo, Math.min(hi, Number((e.target as HTMLInputElement).value)))
    if (isPaintbrush) {
      if (param === 'size')      pSize      = v
      if (param === 'opacity')   pOpacity   = v
      if (param === 'hardness')  pHardness  = v
      if (param === 'softness')  pSoftness  = v
      if (param === 'rotation')  pRotation  = v
      if (param === 'thickness') pThickness = v
      if (param === 'flow')      pFlow     = v
    } else if (isClone) {
      if (param === 'size')      cSize      = v
      if (param === 'opacity')   cOpacity   = v
      if (param === 'hardness')  cHardness  = v
      if (param === 'softness')  cSoftness  = v
      if (param === 'rotation')  cRotation  = v
      if (param === 'thickness') cThickness = v
      if (param === 'flow')      cFlow     = v
    } else {
      if (param === 'size')      eSize      = v
      if (param === 'opacity')   eOpacity   = v
      if (param === 'hardness')  eHardness  = v
      if (param === 'softness')  eSoftness  = v
      if (param === 'rotation')  eRotation  = v
      if (param === 'thickness') eThickness = v
      if (param === 'flow')      eFlow     = v
    }
    applyParams()
  }

  function selectPaintbrush(): void {
    toolManager.setTool(paintbrushTool)
    activeToolName.set('paintbrush')
  }

  function selectEraser(): void {
    toolManager.setTool(eraserTool)
    activeToolName.set('eraser')
  }

  function selectClone(): void {
    toolManager.setTool(cloneTool)
    activeToolName.set('clone')
  }

  function selectBlend(): void {
    toolManager.setTool(blendTool)
    activeToolName.set('blend')
  }

  function selectSaturation(): void {
    toolManager.setTool(saturationTool)
    activeToolName.set('saturation')
  }

  function selectDodgeBurn(): void {
    toolManager.setTool(dodgeBurnTool)
    activeToolName.set('dodge-burn')
  }

  function onBlendParam(param: 'size' | 'hardness' | 'strength', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value)
    if (param === 'size')     { bSize     = Math.max(1,   Math.min(500, v)); blendTool.size     = bSize }
    if (param === 'hardness') { bHardness = Math.max(0,   Math.min(100, v)); blendTool.hardness = bHardness / 100 }
    if (param === 'strength') { bStrength = Math.max(1,   Math.min(100, v)); blendTool.strength = bStrength }
  }

  function onSaturationParam(param: 'size' | 'hardness' | 'strength', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value)
    if (param === 'size')     { satSize     = Math.max(1, Math.min(500, v)); saturationTool.size     = satSize }
    if (param === 'hardness') { satHardness = Math.max(0, Math.min(100, v)); saturationTool.hardness = satHardness / 100 }
    if (param === 'strength') { satStrength = Math.max(1, Math.min(100, v)); saturationTool.strength = satStrength }
  }

  function onSaturationMode(e: Event): void {
    satMode = (e.target as HTMLSelectElement).value as SaturationMode
    saturationTool.mode = satMode
  }

  function onDodgeBurnParam(param: 'size' | 'hardness' | 'strength', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value)
    if (param === 'size')     { dbSize     = Math.max(1, Math.min(500, v)); dodgeBurnTool.size     = dbSize }
    if (param === 'hardness') { dbHardness = Math.max(0, Math.min(100, v)); dodgeBurnTool.hardness = dbHardness / 100 }
    if (param === 'strength') { dbStrength = Math.max(1, Math.min(100, v)); dodgeBurnTool.strength = dbStrength }
  }

  function onDodgeBurnMode(e: Event): void {
    dbMode = (e.target as HTMLSelectElement).value as DodgeBurnMode
    dodgeBurnTool.mode = dbMode
  }

  function selectWarp(): void {
    toolManager.setTool(warpTool)
    activeToolName.set('warp')
  }

  function selectRectSelect(): void {
    toolManager.setTool(rectSelectTool)
    activeToolName.set('rect-select')
  }

  function selectLasso(): void {
    toolManager.setTool(lassoSelectTool)
    activeToolName.set('lasso-select')
  }

  function selectMagicWand(): void {
    toolManager.setTool(magicWandTool)
    activeToolName.set('magic-wand')
  }

  function selectMove(): void {
    toolManager.setTool(moveTool)
    activeToolName.set('move')
  }

  function selectMoveLayer(): void {
    toolManager.setTool(moveLayerTool)
    activeToolName.set('move-layer')
  }

  function selectEyedropper(): void {
    toolManager.setTool(eyedropperTool)
    activeToolName.set('eyedropper')
  }

  function selectFill(): void {
    toolManager.setTool(fillTool)
    activeToolName.set('fill')
  }

  let fillTolerance = fillTool.tolerance

  let edSampleSize = eyedropperTool.sampleSize
  $: edR = parseInt(colorHex.slice(1, 3), 16)
  $: edG = parseInt(colorHex.slice(3, 5), 16)
  $: edB = parseInt(colorHex.slice(5, 7), 16)
  function onEyedropperParam(e: Event): void {
    edSampleSize = parseInt((e.target as HTMLInputElement).value)
    eyedropperTool.sampleSize = edSampleSize
  }

  function onMagicWandParam(e: Event): void {
    mwThreshold = Math.max(0, Math.min(255, Number((e.target as HTMLInputElement).value)))
    magicWandTool.threshold = mwThreshold
  }

  function onMoveLayerPos(axis: 'x' | 'y', e: Event): void {
    const delta = Math.round(Number((e.target as HTMLInputElement).value))
    if (!delta) return
    const layer = get(layerStack).active
    const cw = $canvasSize.width, ch = $canvasSize.height
    const before = { x: layer.offsetX, y: layer.offsetY }
    if (axis === 'x') layer.offsetX = Math.max(-2 * cw, Math.min(2 * cw, layer.offsetX + delta))
    else              layer.offsetY = Math.max(-2 * ch, Math.min(2 * ch, layer.offsetY + delta))
    get(historyManager).push({
      description: 'Move Layer', layerId: layer.id,
      dirtyRect: { x: 0, y: 0, w: cw, h: ch },
      beforePixels: new ArrayBuffer(0), afterPixels: new ArrayBuffer(0),
      offsetBefore: before, offsetAfter: { x: layer.offsetX, y: layer.offsetY },
    })
    moveLayerDX = 0; moveLayerDY = 0
    bump()
    menuAction.set('render')
  }

  function onMoveSelectionPos(axis: 'x' | 'y', e: Event): void {
    const delta = Math.round(Number((e.target as HTMLInputElement).value))
    if (!delta) return
    const sel = get(selection)
    if (!sel || (sel.type !== 'rect' && sel.type !== 'mask')) return
    const cw = $canvasSize.width, ch = $canvasSize.height
    const dx = axis === 'x' ? delta : 0
    const dy = axis === 'y' ? delta : 0
    const layer = get(layerStack).active
    const offsetBefore = { x: layer.offsetX, y: layer.offsetY }
    layer.offsetX = Math.max(-2 * cw, Math.min(2 * cw, layer.offsetX + dx))
    layer.offsetY = Math.max(-2 * ch, Math.min(2 * ch, layer.offsetY + dy))
    selection.set({ ...sel, x: sel.x + dx, y: sel.y + dy })
    get(historyManager).push({
      description: 'Move', layerId: layer.id,
      dirtyRect: { x: 0, y: 0, w: cw, h: ch },
      beforePixels: new ArrayBuffer(0), afterPixels: new ArrayBuffer(0),
      selectionBefore: sel, selectionAfter: get(selection),
      offsetBefore, offsetAfter: { x: layer.offsetX, y: layer.offsetY },
    })
    moveSelDX = 0; moveSelDY = 0
    bump()
    menuAction.set('render')
  }

  function onWarpParam(param: 'size' | 'hardness' | 'strength', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value)
    if (param === 'size')     { wSize     = Math.max(1,   Math.min(500, v)); warpTool.size     = wSize }
    if (param === 'hardness') { wHardness = Math.max(0,   Math.min(100, v)); warpTool.hardness = wHardness / 100 }
    if (param === 'strength') { wStrength = Math.max(1,   Math.min(100, v)); warpTool.strength = wStrength }
  }

  function onWarpMode(e: Event): void {
    wMode = (e.target as HTMLSelectElement).value as WarpMode
    warpTool.mode = wMode
  }

  function onTraceToggle(e: Event): void {
    cTrace = (e.target as HTMLInputElement).checked
    cloneTool.trace = cTrace
    if (!cTrace) cloneTool.clearTrace()
  }

  function onColorChange(e: Event): void {
    const hex = (e.target as HTMLInputElement).value
    colorHex = hex
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    paintbrushTool.color = [r, g, b, 255]
    fillTool.color = [r, g, b, 255]
  }

  onMount(async () => {
    initTelemetry()
    const sessionStart = Date.now()
    track('session_start', {
      platform: navigator.platform,
      screen_width: screen.width,
      screen_height: screen.height,
    })

    activeToolName.subscribe(tool => {
      if (tool) track('tool_selected', { tool })
    })

    await loadSettings()

    const openWithPath = await window.api.getOpenWithFile()
    if (openWithPath) {
      const ls = await fileManager.importImageAsNew(openWithPath)
      const hm = new HistoryManager()
      const title = openWithPath.split(/[\\/]/).pop() ?? 'Untitled'
      openInNewTab(ls, hm, title, null)
      // Close the initial blank tab so only the imported image is shown
      closeTab(0)
      // Wait for Svelte to process all store updates, then explicitly re-trigger fit+render
      await tick()
      menuAction.set('fit-view')
    }

    function handleKey(e: KeyboardEvent): void {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const k = e.key.toUpperCase()
      const hk = $settings.hotkeys
      if (k === hk.paintbrush.toUpperCase())     selectPaintbrush()
      if (k === hk.eraser.toUpperCase())         selectEraser()
      if (k === hk.clone.toUpperCase())          selectClone()
      if (k === hk.warp.toUpperCase())           selectWarp()
      if (k === hk.blend.toUpperCase())          selectBlend()
      if (k === hk.saturation.toUpperCase())     selectSaturation()
      if (k === hk.dodgeBurn.toUpperCase())      selectDodgeBurn()
      if (k === hk.rectSelect.toUpperCase())     selectRectSelect()
      if (k === hk.lasso.toUpperCase())          selectLasso()
      if (k === hk.magicWand.toUpperCase())      selectMagicWand()
      if (k === hk.move.toUpperCase())           selectMove()
      if (k === hk.moveLayer.toUpperCase())      selectMoveLayer()
      if (k === hk.eyedropper.toUpperCase())     selectEyedropper()
      if (k === hk.fill.toUpperCase())           selectFill()
    }
    window.addEventListener('keydown', handleKey)

    window.api.onBeforeClose(() => {
      track('session_end', { duration_ms: Date.now() - sessionStart })
      if (get(tabs).some(t => t.isDirty)) {
        appClosePending = true
      } else {
        window.api.allowClose()
      }
    })

    window.api.onMenuAction(async (action) => {
      const trackableActions = new Set(['new', 'open', 'import', 'import-new', 'save', 'save-as', 'export', 'undo', 'redo', 'new-layer', 'duplicate-layer', 'merge-down', 'merge-all', 'resize-image', 'canvas-size', 'selection-to-new-image'])
      if (trackableActions.has(action)) track('feature_used', { feature: action })

      if (action === 'new')      openNewDialog()
      if (action === 'open')     await open()
      if (action === 'import')               await importImage()
      if (action === 'import-new')           await importImageAsNew()
      if (action === 'selection-to-new-image') selectionToNewImage()
      if (action === 'save')     await save()
      if (action === 'save-as')  await saveAs()
      if (action === 'export')   await exportImage()
      if (action === 'undo')       menuAction.set('undo')
      if (action === 'redo')       menuAction.set('redo')
      if (action === 'copy')       copySelection()
      if (action === 'cut')        cutSelection()
      if (action === 'paste')      pasteClipboard()
      if (action === 'select-all')      selectAll()
      if (action === 'clear-selection') selection.set(null)
      if (action === 'fit-view') menuAction.set('fit-view')
      if (action === 'canvas-size') openCanvasSizeDialog()
      if (action === 'resize-image') openResizeImageDialog()
      if (action === 'new-layer') { get(layerStack).add(); bump() }
      if (action === 'delete-layer') {
        const ls = get(layerStack)
        const layer = ls.active
        const isBackground = ls.layers[0].id === layer.id
        if (isBackground) {
          if (layer.modified && !confirm(`Clear background layer "${layer.name}"? This cannot be undone.`)) return
          layer.clear()
          layer.modified = false
          bump()
          menuAction.set('render')
        } else {
          if (layer.modified && !confirm(`Delete layer "${layer.name}"? This cannot be undone.`)) return
          ls.remove(layer.id)
          bump()
          menuAction.set('render')
        }
      }
      if (action === 'duplicate-layer') {
        const ls = get(layerStack)
        const src = ls.active
        const dup = ls.add(`${src.name} copy`)
        dup.canvas = new OffscreenCanvas(src.canvas.width, src.canvas.height)
        dup.ctx    = dup.canvas.getContext('2d')!
        dup.ctx.drawImage(src.canvas, 0, 0)
        dup.offsetX   = src.offsetX
        dup.offsetY   = src.offsetY
        dup.opacity   = src.opacity
        dup.blendMode = src.blendMode
        bump()
      }
      if (action === 'merge-down') {
        const ls = get(layerStack)
        if (ls.activeIndex > 0) showMergeDownConfirm = true
      }
      if (action === 'merge-all') {
        const ls = get(layerStack)
        if (ls.layers.length > 1) showMergeAllConfirm = true
      }
      if (action === 'layer-move-up')   { const ls = get(layerStack); ls.moveUp(ls.active.id);   bump() }
      if (action === 'layer-move-down') { const ls = get(layerStack); ls.moveDown(ls.active.id); bump() }
      if (action === 'contrast') openContrastDialog()
      if (action === 'adjust-saturation') openSaturationAdjustDialog()
      if (action === 'adjust-vibrancy') openVibrancyDialog()
      if (action === 'adjust-white-balance') openWhiteBalanceDialog()
      if (action === 'adjust-color-rgb') openColorRGBDialog()
      if (action === 'settings-hotkeys') openHotkeysDialog()
      if (action === 'settings-restore-defaults') await resetHotkeys()
      if (action === 'rotate-90-cw' || action === 'rotate-90-ccw' || action === 'rotate-180') {
        const deg = action === 'rotate-180' ? 180 : 90
        const ls = get(layerStack)
        ls.rotateAllLayers(action === 'rotate-90-ccw' ? 270 : deg)
        toolManager.resize(ls.width, ls.height)
        get(historyManager).clear()
        canvasSize.set({ width: ls.width, height: ls.height })
        bump()
        menuAction.set('render')
      }
    })

    return () => window.removeEventListener('keydown', handleKey)
  })

  async function save(): Promise<void> {
    const tab = get(tabs)[get(activeTabIndex)]
    if (tab.filePath) {
      await fileManager.saveProject(get(layerStack), tab.filePath)
      markCurrentTabClean()
    } else {
      await saveAs()
    }
  }

  async function saveAs(): Promise<void> {
    const path = await window.api.saveDialog('untitled.img')
    if (!path) return
    await fileManager.saveProject(get(layerStack), path)
    const title = path.split(/[\\/]/).pop() ?? 'Untitled'
    updateTabMeta(get(activeTabIndex), title, path)
    markCurrentTabClean()
  }

  // Tab close with unsaved-changes check
  function closeTabSafe(idx: number): void {
    if ($tabs[idx].isDirty) {
      closeTabPending = idx
    } else {
      closeTab(idx)
    }
  }

  async function saveAndCloseTab(idx: number): Promise<void> {
    // Switch to the tab being closed so save operates on it
    const prevIdx = get(activeTabIndex)
    if (idx !== prevIdx) switchTab(idx)
    await save()
    closeTabPending = null
    closeTab(idx)
  }

  function discardAndCloseTab(idx: number): void {
    closeTabPending = null
    closeTab(idx)
  }

  // App window close with unsaved-changes check
  async function saveAllAndClose(): Promise<void> {
    for (let i = 0; i < get(tabs).length; i++) {
      if (get(tabs)[i].isDirty) {
        switchTab(i)
        await save()
      }
    }
    appClosePending = false
    window.api.allowClose()
  }

  function discardAndClose(): void {
    appClosePending = false
    window.api.allowClose()
  }

  async function open(): Promise<void> {
    const path = await window.api.openDialog()
    if (!path) return
    if (path.endsWith('.img')) {
      const ls = new LayerStack(1, 1)
      const hm = new HistoryManager()
      await fileManager.openProject(path, ls)
      const title = path.split(/[\\/]/).pop() ?? 'Untitled'
      openInNewTab(ls, hm, title, path)
    } else {
      await doImportImage(path)
    }
  }

  async function importImage(): Promise<void> {
    const path = await window.api.importDialog()
    if (!path) return
    await doImportImage(path)
  }

  function getSelectionBounds(): { cx0: number; cy0: number; cw: number; ch: number } | null {
    const sel = get(selection)
    if (!sel) return null
    const ls = get(layerStack)
    let sx: number, sy: number, sw: number, sh: number
    if (sel.type === 'rect' || sel.type === 'mask') {
      sx = sel.x; sy = sel.y; sw = sel.w; sh = sel.h
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of sel.points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
      }
      sx = Math.floor(minX); sy = Math.floor(minY)
      sw = Math.ceil(maxX) - sx; sh = Math.ceil(maxY) - sy
    }
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy)
    const cx1 = Math.min(ls.width, sx + sw), cy1 = Math.min(ls.height, sy + sh)
    const cw = cx1 - cx0, ch = cy1 - cy0
    return cw > 0 && ch > 0 ? { cx0, cy0, cw, ch } : null
  }

  function compositeSelection(cx0: number, cy0: number, cw: number, ch: number): ImageData {
    const sel = get(selection)!
    const ls = get(layerStack)
    const offscreen = new OffscreenCanvas(cw, ch)
    const ctx = offscreen.getContext('2d')!
    if (sel.type === 'lasso') {
      ctx.beginPath()
      ctx.moveTo(sel.points[0].x - cx0, sel.points[0].y - cy0)
      for (let i = 1; i < sel.points.length; i++) ctx.lineTo(sel.points[i].x - cx0, sel.points[i].y - cy0)
      ctx.closePath()
      ctx.clip()
    }
    for (const layer of ls.layers) {
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode as GlobalCompositeOperation
      ctx.drawImage(layer.canvas, layer.offsetX - cx0, layer.offsetY - cy0)
      ctx.restore()
    }
    const imgData = ctx.getImageData(0, 0, cw, ch)
    if (sel.type === 'mask') {
      const pix = imgData.data
      for (let i = 0; i < ch; i++) {
        for (let j = 0; j < cw; j++) {
          if (!sel.data[i * cw + j]) pix[(i * cw + j) * 4 + 3] = 0
        }
      }
    }
    return imgData
  }

  function copySelection(): void {
    const bounds = getSelectionBounds()
    if (!bounds) return
    const { cx0, cy0, cw, ch } = bounds
    clipboard.set({ imageData: compositeSelection(cx0, cy0, cw, ch), x: cx0, y: cy0 })
  }

  function cutSelection(): void {
    const bounds = getSelectionBounds()
    if (!bounds) return
    const { cx0, cy0, cw, ch } = bounds
    clipboard.set({ imageData: compositeSelection(cx0, cy0, cw, ch), x: cx0, y: cy0 })

    const ls = get(layerStack)
    const layer = ls.active
    const beforeSnapshot = layer.getImageData()
    const sel = get(selection)!

    // Convert doc-space selection coords to layer-local space
    const lox = layer.offsetX, loy = layer.offsetY
    layer.ctx.save()
    if (sel.type === 'lasso') {
      layer.ctx.beginPath()
      layer.ctx.moveTo(sel.points[0].x - lox, sel.points[0].y - loy)
      for (let i = 1; i < sel.points.length; i++) layer.ctx.lineTo(sel.points[i].x - lox, sel.points[i].y - loy)
      layer.ctx.closePath()
      layer.ctx.clip()
      layer.ctx.clearRect(-lox, -loy, ls.width, ls.height)
    } else if (sel.type === 'mask') {
      const lx0 = cx0 - lox, ly0 = cy0 - loy
      const imgData = layer.ctx.getImageData(lx0, ly0, cw, ch)
      const pix = imgData.data
      for (let i = 0; i < ch; i++) {
        for (let j = 0; j < cw; j++) {
          if (sel.data[i * cw + j]) {
            const pi = (i * cw + j) * 4
            pix[pi] = pix[pi + 1] = pix[pi + 2] = pix[pi + 3] = 0
          }
        }
      }
      layer.ctx.putImageData(imgData, lx0, ly0)
    } else {
      layer.ctx.clearRect(sel.x - lox, sel.y - loy, sel.w, sel.h)
    }
    layer.ctx.restore()

    const dr = { x: cx0, y: cy0, w: cw, h: ch }
    get(historyManager).push({
      description: 'Cut',
      layerId: layer.id,
      dirtyRect: dr,
      beforePixels: extractRect(beforeSnapshot, dr.x, dr.y, dr.w, dr.h),
      afterPixels:  layer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    } as any)
    menuAction.set('render')
  }

  function pasteClipboard(): void {
    const clip = get(clipboard)
    if (!clip) return
    const ls = get(layerStack)
    const newLayer = ls.add('Pasted')
    const dr = { x: clip.x, y: clip.y, w: clip.imageData.width, h: clip.imageData.height }
    newLayer.putImageData(clip.imageData, clip.x, clip.y)
    get(historyManager).push({
      description: 'Paste',
      layerId: newLayer.id,
      dirtyRect: dr,
      beforePixels: new ArrayBuffer(dr.w * dr.h * 4),  // new layer was blank
      afterPixels:  newLayer.ctx.getImageData(dr.x, dr.y, dr.w, dr.h).data.buffer.slice(0),
    } as any)
    bump()
    menuAction.set('render')
  }

  function selectAll(): void {
    const ls = get(layerStack)
    selection.set({ type: 'rect', x: 0, y: 0, w: ls.width, h: ls.height })
  }

  function selectionToNewImage(): void {
    const bounds = getSelectionBounds()
    if (!bounds) return
    const { cx0, cy0, cw, ch } = bounds
    const imageData = compositeSelection(cx0, cy0, cw, ch)
    const newLs = new LayerStack(cw, ch)
    newLs.layers[0].name = 'Selection'
    newLs.layers[0].putImageData(imageData)
    const hm = new HistoryManager()
    openInNewTab(newLs, hm, 'Selection', null)
  }

  async function importImageAsNew(): Promise<void> {
    const path = await window.api.importDialog()
    if (!path) return
    const ls = await fileManager.importImageAsNew(path)
    const hm = new HistoryManager()
    const title = path.split(/[\\/]/).pop() ?? 'Untitled'
    openInNewTab(ls, hm, title, null)
  }

  async function doImportImage(path: string): Promise<void> {
    await fileManager.importImage(path, get(layerStack))
    bump()
    menuAction.set('render')
  }

  async function exportImage(): Promise<void> {
    const path = await window.api.exportDialog('export.png')
    if (!path) return
    await fileManager.exportImage(get(layerStack), path)
  }
</script>

<div class="app">
  <header class="toolbar">
    <span class="app-name">Imgtrix</span>

    {#if isMove}

      {#if $selection && ($selection.type === 'rect' || $selection.type === 'mask')}
        <div class="tool-group">
          <span class="label">X</span>
          <input type="number" class="param-num param-num--wide"
            bind:value={moveSelDX}
            on:change={e => onMoveSelectionPos('x', e)} />
        </div>
        <div class="tool-group">
          <span class="label">Y</span>
          <input type="number" class="param-num param-num--wide"
            bind:value={moveSelDY}
            on:change={e => onMoveSelectionPos('y', e)} />
        </div>
      {:else}
        <span class="sel-hint">{$selection ? HINTS.moveSelection : HINTS.makeSelectionFirst}</span>
      {/if}

    {:else if isMoveLayer}

      <div class="tool-group">
        <span class="label">X</span>
        <input type="number" class="param-num param-num--wide"
          bind:value={moveLayerDX}
          on:change={e => onMoveLayerPos('x', e)} />
      </div>
      <div class="tool-group">
        <span class="label">Y</span>
        <input type="number" class="param-num param-num--wide"
          bind:value={moveLayerDY}
          on:change={e => onMoveLayerPos('y', e)} />
      </div>

    {:else if isMagicWand}

      <div class="tool-group">
        <span class="label">{PL.threshold} <Tooltip text={PT.threshold} /></span>
        <input type="range" min="0" max="255" value={mwThreshold} on:input={onMagicWandParam} />
        <input type="number" class="param-num" value={mwThreshold} min="0" max="255" on:change={onMagicWandParam} />
      </div>

    {:else if isSelect}

      {#if $selection}
        {#if $selection.type === 'rect'}
          <span class="sel-info">{$selection.w} × {$selection.h} px</span>
          <span class="sel-info sel-info--muted">at {$selection.x}, {$selection.y}</span>
        {:else}
          <span class="sel-info">{$selection.points.length} pts</span>
        {/if}
        <button class="btn sel-clear" on:click={() => selection.set(null)}>Deselect</button>
      {:else}
        <span class="sel-hint">{$activeToolName === 'lasso-select' ? HINTS.lassoSelect : HINTS.rectSelect}</span>
      {/if}

    {:else if isBlend}

      <div class="tool-group">
        <span class="label">{PL.size} <Tooltip text={PT.size} /></span>
        <input type="range" min="1" max="500" value={bSize} on:input={e => onBlendParam('size', e)} />
        <input type="number" class="param-num" value={bSize} min="1" max="500" on:change={e => onBlendParam('size', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.hardness} <Tooltip text={PT.hardness} /></span>
        <input type="range" min="0" max="100" value={bHardness} on:input={e => onBlendParam('hardness', e)} />
        <input type="number" class="param-num" value={bHardness} min="0" max="100" on:change={e => onBlendParam('hardness', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.strength} <Tooltip text={PT.strength} /></span>
        <input type="range" min="1" max="100" value={bStrength} on:input={e => onBlendParam('strength', e)} />
        <input type="number" class="param-num" value={bStrength} min="1" max="100" on:change={e => onBlendParam('strength', e)} />
      </div>

    {:else if isSaturation}

      <div class="tool-group">
        <span class="label">{PL.size} <Tooltip text={PT.size} /></span>
        <input type="range" min="1" max="500" value={satSize} on:input={e => onSaturationParam('size', e)} />
        <input type="number" class="param-num" value={satSize} min="1" max="500" on:change={e => onSaturationParam('size', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.hardness} <Tooltip text={PT.hardness} /></span>
        <input type="range" min="0" max="100" value={satHardness} on:input={e => onSaturationParam('hardness', e)} />
        <input type="number" class="param-num" value={satHardness} min="0" max="100" on:change={e => onSaturationParam('hardness', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.strength} <Tooltip text={PT.strength} /></span>
        <input type="range" min="1" max="100" value={satStrength} on:input={e => onSaturationParam('strength', e)} />
        <input type="number" class="param-num" value={satStrength} min="1" max="100" on:change={e => onSaturationParam('strength', e)} />
      </div>
      <div class="tool-group tool-group--mode">
        <span class="label">{PL.mode} <Tooltip text={PT.satMode} /></span>
        <select class="mode-select" value={satMode} on:change={onSaturationMode}>
          <option value="up">{SAT_MODE_LABELS.up}</option>
          <option value="down">{SAT_MODE_LABELS.down}</option>
        </select>
      </div>

    {:else if isDodgeBurn}

      <div class="tool-group">
        <span class="label">{PL.size} <Tooltip text={PT.size} /></span>
        <input type="range" min="1" max="500" value={dbSize} on:input={e => onDodgeBurnParam('size', e)} />
        <input type="number" class="param-num" value={dbSize} min="1" max="500" on:change={e => onDodgeBurnParam('size', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.hardness} <Tooltip text={PT.hardness} /></span>
        <input type="range" min="0" max="100" value={dbHardness} on:input={e => onDodgeBurnParam('hardness', e)} />
        <input type="number" class="param-num" value={dbHardness} min="0" max="100" on:change={e => onDodgeBurnParam('hardness', e)} />
      </div>
      <div class="tool-group">
        <span class="label">{PL.strength} <Tooltip text={PT.strength} /></span>
        <input type="range" min="1" max="100" value={dbStrength} on:input={e => onDodgeBurnParam('strength', e)} />
        <input type="number" class="param-num" value={dbStrength} min="1" max="100" on:change={e => onDodgeBurnParam('strength', e)} />
      </div>
      <div class="tool-group tool-group--mode">
        <span class="label">{PL.mode} <Tooltip text={PT.dodgeMode} /></span>
        <select class="mode-select" value={dbMode} on:change={onDodgeBurnMode}>
          <option value="dodge">{DODGE_MODE_LABELS.dodge}</option>
          <option value="burn">{DODGE_MODE_LABELS.burn}</option>
        </select>
      </div>

    {:else if isFill}

      <div class="tool-group tool-group--color">
        <span class="label">{PL.color}</span>
        <input type="color" value={colorHex} on:input={onColorChange} />
      </div>
      <div class="tool-group">
        <span class="label">Tolerance</span>
        <input type="range" min="0" max="255" value={fillTolerance} on:input={e => { fillTolerance = +e.currentTarget.value; fillTool.tolerance = fillTolerance }} />
        <input type="number" class="param-num" value={fillTolerance} min="0" max="255" on:change={e => { fillTolerance = +e.currentTarget.value; fillTool.tolerance = fillTolerance }} />
      </div>

    {:else if isEyedropper}

      <div class="tool-group">
        <span class="label">{PL.sampleSize} <Tooltip text={PT.sampleSize} /></span>
        <input type="range" min="1" max="51" step="2" value={edSampleSize} on:input={onEyedropperParam} />
        <input type="number" class="param-num" value={edSampleSize} min="1" max="51" step="2" on:change={onEyedropperParam} />
      </div>
      <div class="tool-group tool-group--color">
        <span class="label">{PL.pickedColor}</span>
        <input type="color" value={colorHex} on:input={onColorChange} title={PT.sampledColor} />
      </div>
      <span class="ed-color-readout">{colorHex}&ensp;RGB: {edR}:{edG}:{edB}</span>

    {:else if isPaintbrush || isClone || $activeToolName === 'eraser'}

      {#if $activeToolName === 'paintbrush'}
      <div class="tool-group tool-group--color">
        <span class="label">{PL.color} <Tooltip text={PT.brushColor} /></span>
        <input type="color" value={colorHex} on:input={onColorChange} title={PT.brushColor} />
      </div>
      <div class="divider" />
      {/if}

      <div class="tool-group">
        <span class="label">{PL.size} <Tooltip text={PT.size} /></span>
        <input type="range" min="1" max="500" value={size} on:input={e => onParam('size', e)} />
        <input type="number" class="param-num" value={size} min="1" max="500" on:change={e => onParam('size', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.opacity} <Tooltip text={PT.opacity} /></span>
        <input type="range" min="1" max="100" value={opacity} on:input={e => onParam('opacity', e)} />
        <input type="number" class="param-num" value={opacity} min="1" max="100" on:change={e => onParam('opacity', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.hardness} <Tooltip text={PT.hardness} /></span>
        <input type="range" min="0" max="100" value={hardness} on:input={e => onParam('hardness', e)} />
        <input type="number" class="param-num" value={hardness} min="0" max="100" on:change={e => onParam('hardness', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.softness} <Tooltip text={PT.softness} /></span>
        <input type="range" min="0" max="100" value={softness} on:input={e => onParam('softness', e)} />
        <input type="number" class="param-num" value={softness} min="0" max="100" on:change={e => onParam('softness', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.rotation} <Tooltip text={PT.rotation} /></span>
        <input type="range" min="0" max="359" value={rotation} on:input={e => onParam('rotation', e)} />
        <input type="number" class="param-num" value={rotation} min="0" max="359" on:change={e => onParam('rotation', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.thickness} <Tooltip text={PT.thickness} /></span>
        <input type="range" min="1" max="100" value={thickness} on:input={e => onParam('thickness', e)} />
        <input type="number" class="param-num" value={thickness} min="1" max="100" on:change={e => onParam('thickness', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.flow} <Tooltip text={PT.flow} /></span>
        <input type="range" min="0" max="100" value={flow} on:input={e => onParam('flow', e)} />
        <input type="number" class="param-num" value={flow} min="0" max="100" on:change={e => onParam('flow', e)} />
      </div>

      {#if isClone}
      <div class="divider" />
      <div class="tool-group tool-group--trace">
        <span class="label">{PL.trace} <Tooltip text={PT.trace} /></span>
        <label class="trace-label">
          <input type="checkbox" checked={cTrace} on:change={onTraceToggle} />
          <span class="clone-hint">Source mark follows cursor</span>
        </label>
      </div>
      {/if}

    {:else}

      <div class="tool-group">
        <span class="label">{PL.size} <Tooltip text={PT.size} /></span>
        <input type="range" min="1" max="500" value={wSize} on:input={e => onWarpParam('size', e)} />
        <input type="number" class="param-num" value={wSize} min="1" max="500" on:change={e => onWarpParam('size', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.hardness} <Tooltip text={PT.hardness} /></span>
        <input type="range" min="0" max="100" value={wHardness} on:input={e => onWarpParam('hardness', e)} />
        <input type="number" class="param-num" value={wHardness} min="0" max="100" on:change={e => onWarpParam('hardness', e)} />
      </div>

      <div class="tool-group">
        <span class="label">{PL.strength} <Tooltip text={PT.strength} /></span>
        <input type="range" min="1" max="100" value={wStrength} on:input={e => onWarpParam('strength', e)} />
        <input type="number" class="param-num" value={wStrength} min="1" max="100" on:change={e => onWarpParam('strength', e)} />
      </div>

      <div class="tool-group tool-group--mode">
        <span class="label">{PL.mode} <Tooltip text={PT.warpMode} /></span>
        <select class="mode-select" value={wMode} on:change={onWarpMode}>
          <option value="push">{WARP_MODE_LABELS.push}</option>
          <option value="twirl">{WARP_MODE_LABELS.twirl}</option>
          <option value="bloat">{WARP_MODE_LABELS.bloat}</option>
          <option value="pucker">{WARP_MODE_LABELS.pucker}</option>
          <option value="reconstruct">{WARP_MODE_LABELS.reconstruct}</option>
        </select>
      </div>

    {/if}

    <div class="spacer" />

    <span class="zoom-display">{$zoomPct}%</span>
    <span class="canvas-size">{$canvasSize.width}×{$canvasSize.height}</span>
  </header>

  <div class="tab-bar">
    {#each $tabs as tab, i (tab.id)}
      <button
        class="tab" class:active={i === $activeTabIndex}
        on:click={() => switchTab(i)}
        title={tab.filePath ?? tab.title}
      >
        {#if tab.isDirty}<span class="tab-dirty" title={TAB_LABELS.unsavedHint}>{TAB_LABELS.unsavedDot}</span>{/if}
        <span class="tab-title">{tab.title}</span>
        <button
          class="tab-close"
          on:click|stopPropagation={() => closeTabSafe(i)}
          title={TAB_LABELS.closeTab}
          disabled={$tabs.length === 1}
        >×</button>
      </button>
    {/each}
    <button class="tab-add" on:click={openNewDialog} title={TAB_LABELS.newCanvas}>+</button>
  </div>

  <div class="body">
    <aside class="tool-sidebar">
      <button
        class="tool-btn" class:active={$activeToolName === 'paintbrush'}
        on:click={selectPaintbrush} title={toolTitle('paintbrush')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 104 104 104" class="tool-icon"><path d="m201.9 6.06c-2.87-3.03-7.02-2.25-9.45 0.31l-73.53 69c-12.47 11.29-22.09 23.34-30.09 32.07-2.75 0.32-4.21 2.45-4.06 5.07-3.24 0.02-4.72 2.4-5.72 5.78l-34.04 30.45c-2.55 2.47-6.09 5.49-6.49 6.99-0.13-0.04-0.26-0.1-0.37-0.09-13.27 6.53-18.04 13.62-20.77 27.11-1.71 8.48-2.37 12.17-12.34 20 12.95 2.96 31.72-0.37 43.42-11.43 6.16-5.88 8.29-13.51 9.04-18.16 1.45-0.24 2.45-0.9 4.25-3.05l29.6-38.49c2.87-0.46 4.54-1.83 5.38-6.21 3.39-0.3 4.96-2.55 5.02-5.65 10.97-8.91 22.17-17.49 35.4-33.16l64.01-71c3.1-3.11 3.5-6.69 0.74-9.54zm-180.8 176c2.82-11.99 7.86-18.79 18.18-21.17l0.58 0.53c-6.43 3.79-12.39 11.25-15.43 23.62 4.45-10.27 10.29-16.81 16.94-20.8l-0.44-0.41c0.86 0.04 1.71 0.16 2.56 0.39-7.61 10.21-9.55 24.54-16.57 33.03 11.31-3.57 19.4-11.78 24.15-23.98-2.39 11.78-11.26 22.7-24.15 23.98 4.85-0.88 2.88-0.48 0 0-4.02 1.16-2.1 0.39-5.82-15.19zm36.3-12.41-14.81-14.64c-0.44-0.99 0.51-1.91 4.28-5.39l32.49-27.06 7.99 7.37-29.95 39.72zm33.7-41.9-8.2-7.76c-1.73-1.74 0.76-5.04 2.91-3.31l7.37 7.37c1.33 1.89 0 4.14-2.08 3.7zm6.05-6.17c-0.88 0.87-2.1 0.46-2.91-0.46l-6.49-7.41c-1.34-2.03 0.65-4.17 2.51-3.24l7.81 8.39c0.87 0.87 0.44 1.86-0.92 2.72zm4.66-7.91-0.25-0.27 76.62-92.47-84.02 86.28 25.76-28.8 61.82-57.56-3.56 0.08 4.17-3.33-64.15 69.44-16.39 26.63z" fill="currentColor"/><path d="m53.98 148.4c0.6-1.24 1.8-0.67 3.33 0.07 3.96 2 5.78 4.43 7.02 6.63 0.91 1.7 0.66 1.7 0.41 2.16-0.41 0.69-0.98 0.59-1.58-0.49-1.72-2.52-4-5.13-7.75-7.64-0.6-0.43-1.43-0.43-1.43-0.73z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'eraser'}
        on:click={selectEraser} title={toolTitle('eraser')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" class="tool-icon"><path d="m237.7 75.76-54.75-56.69c-3.02-3.19-5.96-3.65-9.53-3.45-3.98-0.2-6.68 1.47-9.28 4.09l-150.6 146.7c-4.25 4.27-5.69 8.53-5.12 14.28 0.42 4.98 2.72 8.46 6.59 12.28l34.9 35.14c4.27 4.29 7.8 5.78 12.89 5.58h124.8c2.95 0 2.95-2.64 2.95-3.46 0-1.5-1.21-3.56-3.17-3.56h-57.48l108.3-104.4c3.59-3.5 3.58-7.44 3.58-11.46v-23.9c0-4.63-1.12-8.02-4.19-11.15zm-175.4 150.6c-3.53-0.1-5.64-1.42-7.58-3.52l-36.42-36.6c-2.42-2.45-3.39-4.02-3.39-7.55 0-3.95 1.61-6.44 5.04-9.69l44.48-42.21 59.78 60.89-39.5 38.68h-22.41zm57.31 0h-24.86l34.23-33.32 12.63 12.43-22 20.89zm115.3-130.1-90.97 87.25c-1.63 1.64-3.02 1.13-4.2-0.06-1.09-1.11-1.16-2.71 0.23-4.16l94.94-90.94v7.91z" fill="currentColor"/><path d="m216.7 206.7h-44.23c-2.7 0-3.29 2.06-3.29 3.35 0 1.8 1.46 3.08 3.29 3.08h44.23c2.36 0 3.2-1.7 3.2-3.09 0-1.69-1.2-3.34-3.2-3.34z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'clone'}
        on:click={selectClone} title={toolTitle('clone')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" class="tool-icon"><path d="M 498.292 758.79 C 501.565 759.578 506.26 766.879 508.453 769.823 C 551.446 827.574 622.418 864.664 690.342 883.832 C 755.428 868.736 819.757 838.087 867.129 790.107 C 876.658 780.455 884.707 769.75 892.936 759.004 C 936.76 787.199 965.129 804.928 1001.61 842.025 C 1053.99 895.738 1090.56 962.852 1107.28 1035.99 C 1120.43 1091.79 1117.85 1142.68 1117.88 1199.5 L 1117.69 1348.87 L 1117.69 1703.04 C 1117.35 1737.87 1111.99 1761.9 1085.78 1787.43 C 1054.82 1817.58 1020.31 1816.1 980.719 1815.53 C 979.792 1676.3 979.694 1537.06 980.425 1397.82 C 980.475 1316.4 978.501 1231.86 979.421 1150.9 L 932.114 1150.85 L 932.955 1816.76 C 873.48 1814.65 812.829 1817.1 753.248 1816.11 C 736.465 1815.84 718.441 1815.81 701.754 1816.71 L 701.83 1787.5 L 701.791 1566.82 L 701.925 1503.96 C 701.969 1495.88 702.962 1479.2 701.428 1472.19 C 698.2 1470.16 695.382 1470.61 691.589 1471.16 C 690.034 1473.84 689.627 1476.93 689.644 1480 C 689.817 1512.31 689.86 1544.68 689.884 1576.98 L 690.323 1816.07 C 613.633 1815.2 535.667 1815.91 458.897 1816.08 L 458.907 1152.49 C 444.262 1151.55 426.784 1152.08 411.996 1152.22 L 411.979 1618.71 L 412.015 1749.54 C 411.964 1771.27 411.165 1793.73 411.682 1815.34 C 392.553 1815.26 371.591 1817.43 352.997 1813.08 C 326.221 1806.82 301.253 1791.02 286.673 1767.42 C 279.569 1755.33 271.115 1738.6 270.428 1724.22 C 269.034 1695.06 269.758 1664.8 269.771 1635.58 L 269.867 1463.67 L 269.783 1231.63 C 269.787 1175.3 265.931 1097.66 278.591 1044.78 C 300.574 951.565 352.477 868.114 426.366 807.182 C 448.402 789.346 474.12 773.51 498.292 758.79 z" fill="#181818"/><path d="M 679.389 199.157 C 820.196 190.203 941.643 296.997 950.769 437.793 C 959.895 578.589 853.25 700.167 712.465 709.465 C 571.436 718.78 449.602 611.909 440.46 470.869 C 431.319 329.83 538.338 208.126 679.389 199.157 z" fill="#000"/><path d="M 1340.54 200.492 C 1481.5 194.664 1600.48 304.231 1606.26 445.189 C 1612.05 586.148 1502.45 705.096 1361.49 710.839 C 1220.59 716.58 1101.7 607.034 1095.92 466.136 C 1090.13 325.237 1199.64 206.317 1340.54 200.492 z" fill="rgb(154,154,154)"/><path d="M 498.292 758.79 C 501.565 759.578 506.26 766.879 508.453 769.823 C 551.446 827.574 622.418 864.664 690.342 883.832 C 755.428 868.736 819.757 838.087 867.129 790.107 C 876.658 780.455 884.707 769.75 892.936 759.004 C 936.76 787.199 965.129 804.928 1001.61 842.025 C 1053.99 895.738 1090.56 962.852 1107.28 1035.99 C 1120.43 1091.79 1117.85 1142.68 1117.88 1199.5 L 1117.69 1348.87 L 1117.69 1703.04 C 1117.35 1737.87 1111.99 1761.9 1085.78 1787.43 C 1054.82 1817.58 1020.31 1816.1 980.719 1815.53 C 979.792 1676.3 979.694 1537.06 980.425 1397.82 C 980.475 1316.4 978.501 1231.86 979.421 1150.9 L 932.114 1150.85 L 932.955 1816.76 C 873.48 1814.65 812.829 1817.1 753.248 1816.11 C 736.465 1815.84 718.441 1815.81 701.754 1816.71 L 701.83 1787.5 L 701.791 1566.82 L 701.925 1503.96 C 701.969 1495.88 702.962 1479.2 701.428 1472.19 C 698.2 1470.16 695.382 1470.61 691.589 1471.16 C 690.034 1473.84 689.627 1476.93 689.644 1480 C 689.817 1512.31 689.86 1544.68 689.884 1576.98 L 690.323 1816.07 C 613.633 1815.2 535.667 1815.91 458.897 1816.08 L 458.907 1152.49 C 444.262 1151.55 426.784 1152.08 411.996 1152.22 L 411.979 1618.71 L 412.015 1749.54 C 411.964 1771.27 411.165 1793.73 411.682 1815.34 C 392.553 1815.26 371.591 1817.43 352.997 1813.08 C 326.221 1806.82 301.253 1791.02 286.673 1767.42 C 279.569 1755.33 271.115 1738.6 270.428 1724.22 C 269.034 1695.06 269.758 1664.8 269.771 1635.58 L 269.867 1463.67 L 269.783 1231.63 C 269.787 1175.3 265.931 1097.66 278.591 1044.78 C 300.574 951.565 352.477 868.114 426.366 807.182 C 448.402 789.346 474.12 773.51 498.292 758.79 z" fill="rgb(154,154,154)" transform="translate(660,0)"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'warp'}
        on:click={selectWarp} title={toolTitle('warp')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" class="tool-icon"><path d="M 1512.77 657.454 C 1560.43 656.297 1607.67 666.559 1650.55 687.383 C 1721.63 722.245 1789.13 799.627 1814.56 874.323 C 1798.79 855.222 1781.71 837.043 1762.23 821.639 C 1705.83 777.056 1631.08 752.782 1559.23 761.033 C 1533.83 763.949 1508.08 769.253 1484.02 777.955 C 1395.03 810.138 1313.72 884.214 1256.55 958.161 C 1213.43 1013.93 1178.14 1075.07 1140.93 1134.79 C 1108.63 1186.63 1073.84 1238.09 1035.76 1285.88 C 958.269 1383.12 848.45 1474.73 725.63 1505.44 C 703.683 1510.93 680.682 1513.35 658.237 1515.86 C 625.964 1518.94 593.416 1517.39 561.583 1511.25 C 460.221 1491.92 376.2 1431.8 318.607 1347.12 C 382.981 1398.72 449.588 1429.71 534.097 1426.39 C 701.874 1420.14 829.29 1294.98 920.501 1165.64 C 956.407 1114.73 987.404 1060.67 1021.67 1009.03 C 1113.25 871.023 1228.06 727.086 1392.34 675.763 C 1429.07 664.287 1474.31 659.133 1512.77 657.454 z" fill="currentColor"/><path d="M 243.405 1184.19 C 381.381 1355.14 565.625 1290.76 695.682 1152.28 C 710.084 1136.95 724.439 1122.56 737.668 1105.95 C 783.763 1048.1 823.409 985.722 864.041 924.025 C 872.698 911.31 882.128 899.451 890.845 886.724 C 1025.23 690.556 1252 475.105 1511.01 543.547 C 1525.24 547.308 1543.92 553.281 1557.28 559.406 C 1621.09 582.144 1688.31 638.588 1724.89 695.699 C 1698.63 677.872 1651.56 655.49 1621.74 645.026 C 1564.4 624.912 1497.45 623.52 1438.17 634.502 C 1337.53 653.368 1257.41 698 1181.67 766.263 C 1168.34 778.275 1155.86 791.924 1143.05 804.522 C 1137.78 809.709 1131.2 817.59 1125.82 822.107 C 1107.56 844.578 1088.78 865.695 1070.42 888.835 C 926.118 1070.68 814.522 1358.69 554.005 1393.26 C 420.277 1411.01 286.986 1310.83 239.659 1189.15 L 241.108 1187.78 L 240.968 1185.02 L 243.405 1184.19 z" fill="currentColor"/><path d="M 1125.82 822.107 L 1125.67 821.204 C 1127.49 813.713 1180.27 765.82 1189.24 756.615 L 1188.91 755.007 C 1186.74 753.341 1186.56 753.341 1184.96 751.173 C 1185.75 748.254 1188.44 745.819 1190.55 743.443 L 1192.05 743.875 L 1191.7 741.937 C 1189.09 739.703 1188.79 739.592 1186.77 736.93 C 1173.73 719.715 1173.98 721.715 1171.39 700.732 C 1168.86 701.02 1168.29 701.173 1165.79 700.916 C 1166.17 695.009 1167.04 694.335 1162.21 690.9 C 1156.58 690.466 1152.32 699.028 1138.93 695.966 L 1138.86 694.231 C 1140.47 692.013 1140.92 691.88 1141.33 689.255 C 1127.97 694.133 1084.13 747.323 1076.58 750.216 C 1078.15 746.133 1095.5 729.472 1099.2 725.72 C 1215.66 607.61 1381.52 528.098 1549.45 565.967 C 1564.24 569.304 1567.19 567.892 1583 573.688 C 1576.18 568.963 1561.72 563.885 1557.28 559.406 C 1621.09 582.144 1688.31 638.588 1724.89 695.699 C 1698.63 677.872 1651.56 655.49 1621.74 645.026 C 1564.4 624.912 1497.45 623.52 1438.17 634.502 C 1337.53 653.368 1257.41 698 1181.67 766.263 C 1168.34 778.275 1155.86 791.924 1143.05 804.522 C 1137.78 809.709 1131.2 817.59 1125.82 822.107 z" fill="currentColor"/><path d="M 1579.07 904.422 C 1741.33 890.511 1856.7 1012.86 1901.47 1156.98 C 1743.88 927.199 1535.46 966.32 1369.16 1154.73 C 1363.27 1161.41 1357.35 1168.23 1351.56 1175.03 C 1329.73 1200.53 1309.18 1227.09 1289.99 1254.63 C 1268.82 1285.61 1248.72 1318.4 1228.18 1349.89 C 1157.96 1457.59 1073.95 1540.32 952.26 1586.59 C 879.678 1615.35 786.586 1623.76 709.845 1611.22 C 645.493 1600.7 571.455 1573.18 520.565 1531.71 C 575.181 1545.47 610.392 1550.51 667.006 1546.39 C 843.441 1533.54 979.341 1412.62 1081.2 1277.38 C 1114.59 1233.05 1147.22 1185.15 1183.41 1143.06 C 1282.85 1027.4 1420.84 915.048 1579.07 904.422 z" fill="currentColor"/><path d="M 148.995 903.916 C 202.932 965.471 258.638 1017.71 340.991 1039.03 C 383.074 1049.85 427.178 1050.12 469.387 1039.8 C 576.86 1013.93 649.191 937.473 721.23 858.714 C 760.825 814.683 799.498 769.829 837.221 724.183 C 912.558 633.041 987.45 538.51 1090.85 477.213 C 1156.27 438.431 1231.21 420.64 1306.97 428.363 C 1331.07 430.819 1354.74 436.699 1378.13 442.881 C 1406.28 451.803 1430.65 461.388 1457.2 474.595 C 1483.24 487.547 1506.29 503.534 1530.99 518.696 C 1503.75 511.138 1471.89 503.58 1443.41 501.498 C 1328.59 493.108 1217.12 532.667 1123.7 597.78 C 1111.03 606.608 1098.77 617.168 1086.09 625.641 C 1084.32 627.969 1074.59 635.596 1071.9 637.857 C 983.451 712.248 912.875 802.032 849.526 898.033 C 836.151 918.639 822.658 939.168 809.05 959.62 C 799.16 974.269 792.033 986.541 778.234 997.984 C 722.361 1044.32 663.872 1087.28 595.757 1113.81 C 510.584 1146.98 414.714 1156.09 329.506 1117.49 C 258.896 1085.22 207.361 1021.57 173.2 953.498 C 164.999 937.122 155.253 921.115 148.995 903.916 z" fill="currentColor"/><path d="M 1094.24 523.74 C 1094.26 520.821 1094.7 519.504 1095.28 516.655 L 1092.61 515.486 C 1098.92 509.34 1113.1 501.572 1120.91 496.745 C 1188.37 455.045 1268.26 434.654 1347.38 444.716 C 1355.52 445.75 1368.14 446.986 1376.16 446.771 C 1376.95 445.337 1377.43 444.347 1378.13 442.881 C 1406.28 451.803 1430.65 461.388 1457.2 474.595 C 1483.24 487.547 1506.29 503.534 1530.99 518.696 C 1503.75 511.138 1471.89 503.58 1443.41 501.498 C 1328.59 493.108 1217.12 532.667 1123.7 597.78 C 1111.03 606.608 1098.77 617.168 1086.09 625.641 C 1092.36 613.926 1123.62 601.644 1128.43 582.92 C 1126.38 581.658 1127.21 582.465 1125.9 580.536 C 1127.53 577.379 1127.99 576.484 1129.11 573.167 C 1127.08 569.969 1121.42 560.336 1118.92 558.591 C 1118.2 558.505 1117.48 558.407 1116.77 558.298 C 1116.07 558.188 1113.61 557.809 1113.32 557.361 C 1106.64 546.977 1101.47 533.493 1094.24 523.74 z" fill="currentColor"/><path d="M 1582.07 789.441 C 1627.49 788.831 1672.28 800.086 1712.01 822.093 C 1768.58 853.718 1813.51 902.657 1840.19 961.715 C 1848.38 980.242 1852.76 995.551 1858.19 1014.81 C 1826.88 970.832 1776.96 927.494 1727.92 904.735 C 1634.74 861.492 1551.42 869.46 1458.27 902.633 C 1365.56 938.011 1278.58 1000.13 1211.46 1073.03 C 1216.2 1063.1 1229.12 1044.6 1235.58 1035.21 C 1261.85 996.217 1290.91 959.18 1322.53 924.387 C 1392.37 848.745 1476.73 793.645 1582.07 789.441 z" fill="currentColor"/><path d="M 183.918 1025.87 C 192.581 1035.53 200.87 1048.56 211.154 1059.77 C 257.846 1110.68 314.351 1148.54 382.523 1164.25 C 467.996 1183.94 565.945 1166.28 644.418 1129.08 C 670.599 1116.67 694.786 1098.8 719.041 1083.72 C 702.684 1099.56 690.038 1115.97 674.333 1132.18 C 619.673 1187.17 572.781 1226.17 497.003 1250.02 C 352.972 1295.33 255.522 1185.42 200.79 1067.57 C 194.641 1054.33 188.026 1040.11 183.918 1025.87 z" fill="currentColor"/><path d="M 232.988 1170.71 C 236.623 1175.08 239.982 1179.65 243.405 1184.19 L 240.968 1185.02 L 241.108 1187.78 L 239.659 1189.15 C 236.935 1183.19 235.042 1176.94 232.988 1170.71 z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'blend'}
        on:click={selectBlend} title={toolTitle('blend')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" class="tool-icon"><path d="M 1112.3 359.094 C 1126.31 350.624 1139.53 340.869 1153.18 331.867 C 1171.97 319.47 1189.56 305.705 1207.71 292.424 C 1219.56 283.749 1232 275.989 1244.02 267.557 C 1285.97 236.256 1328.5 205.617 1370.51 174.436 L 1430.46 129.939 C 1443.66 120.079 1461.43 101.058 1478.62 105.796 C 1493.73 109.96 1504.07 124.78 1498 140.407 C 1491.68 156.659 1475.58 164.326 1462.38 174.757 C 1443.07 190.011 1422.35 203.879 1403.07 219.223 C 1394.28 226.224 1384.16 233.307 1375.71 240.317 C 1368.51 246.286 1371.72 248.656 1359.45 252.307 C 1356.73 253.117 1343.87 265.537 1340.29 267.251 C 1319.38 281.527 1301.17 296.262 1281.5 312.025 C 1297.08 304.446 1308.57 294.615 1325.63 290.274 C 1335.56 293.771 1341.58 297.684 1348.95 305.373 C 1345.12 312.756 1341.97 317.673 1337.38 324.667 C 1338.36 327.618 1338.59 326.517 1338.03 328.971 C 1335.73 328.758 1336.86 329.009 1334.62 328.19 C 1330.39 331.084 1327.88 333.888 1324.28 337.496 C 1329.29 339.434 1333.99 341.61 1339.03 343.372 C 1352.36 339.516 1355.82 339.148 1363.87 351.319 C 1352.4 367.779 1342.47 369.556 1327.49 381.565 C 1325.97 382.785 1330.2 394.015 1325.5 398.867 C 1297.98 427.242 1261.93 455.036 1236.41 484.759 C 1312.54 430.805 1395 381.288 1472.52 329.063 C 1498.4 311.625 1525.89 350.147 1501.46 369.909 C 1466.31 398.352 1435.09 431.573 1402.52 463.043 C 1437.94 445.432 1481.51 423.69 1514.72 402.764 C 1551.17 379.793 1587.11 355.231 1624.58 333.49 C 1637.81 325.813 1651.47 315.865 1664.93 309.107 C 1646.83 332.588 1628.27 355.707 1609.25 378.449 C 1597.72 391.981 1575.65 415.787 1566.09 429.077 L 1566.35 430.484 C 1566.95 433.961 1568.09 440.678 1565.54 443.727 C 1543.22 470.482 1518.66 495.606 1495.42 521.561 C 1506.78 514.105 1562.25 471.158 1571.79 483.682 C 1567.62 496.255 1496.58 562.251 1483.48 574.422 C 1486.19 574.317 1532.48 544.806 1539.7 540.797 C 1547.14 536.664 1557.57 526.187 1566.88 529.232 C 1570.72 532.861 1569.93 533.142 1570.78 539.092 C 1572.67 538.837 1576.43 535.636 1578.06 534.316 C 1593.5 521.756 1613.94 502.438 1634.09 518.374 C 1644.59 526.273 1650.95 544.505 1641.71 555.57 C 1634.64 564.038 1625.89 570.866 1618.49 578.757 C 1599.59 598.929 1573.43 622.372 1559.73 646.133 C 1573.14 638.399 1594.91 619.246 1606.93 619.354 L 1608.5 620.138 C 1609.53 625.913 1594.98 646.037 1591.06 655.312 C 1611.11 638.731 1632.48 623.791 1651.93 606.38 C 1662.48 596.928 1674.41 586.193 1689.5 587.763 C 1716.81 592.085 1716.11 623.446 1702.9 641.567 C 1688.94 659.961 1671.32 673.942 1655.2 690.195 C 1633.25 710.729 1613.01 731.016 1592.52 753.034 L 1597.65 755.146 L 1598.51 754.673 C 1609.05 748.794 1619.66 740.938 1629.96 734.206 C 1644.82 724.494 1660.09 715.282 1673.21 703.235 C 1678.18 698.663 1691.06 694.011 1696.7 688.798 C 1711.32 679.419 1725.67 668.427 1740.27 659.272 L 1740.32 658.167 L 1738.18 656.574 C 1742.76 654.009 1744.71 655.891 1746.07 655.162 C 1761.57 646.897 1786.69 627.367 1799.55 617.741 C 1814.77 606.502 1830.06 595.355 1845.42 584.299 C 1854.24 577.896 1867.7 566.771 1876.64 562.421 C 1896.52 552.751 1922.49 577.452 1913.16 598.324 C 1907.09 611.909 1887.74 622.574 1875.84 631.489 L 1816.95 675.982 C 1804.64 685.152 1792.68 693.601 1780.65 703.273 C 1759.35 720.413 1745.1 746.831 1727.91 765.436 C 1736.82 761.509 1770.12 744.765 1776.77 742.903 L 1778.26 744.016 C 1776.32 752.92 1766.05 762.052 1759.42 767.997 C 1743.84 781.974 1729.04 796.596 1714.09 811.241 C 1733.84 805.426 1757.87 792.675 1775.99 790.732 C 1752.56 818.446 1714.16 839.061 1694.44 866.81 C 1727.77 848.657 1756.03 831.893 1787.3 809.8 C 1796.52 803.316 1805.59 796.613 1814.5 789.699 C 1819.38 785.879 1828.47 777.647 1833.12 775.299 C 1839.23 772.139 1846.35 771.52 1852.91 773.577 C 1870.92 779.031 1878.88 804.606 1865.44 816.902 C 1829.74 849.551 1786.42 877.5 1751.4 911.147 C 1740.97 921.165 1687.07 967.632 1683.76 976.302 L 1684.87 977.271 C 1687.9 976.451 1709.04 966.42 1714.78 964.003 L 1716.62 960.672 L 1718.13 960.767 C 1725.32 961.162 1727.12 960.367 1733.87 957.902 C 1732.77 961.945 1731.62 965.974 1730.41 969.987 C 1731.85 971.674 1732.02 971.73 1733.84 973.038 L 1733.71 974.812 C 1730.78 975.735 1727.74 972.74 1726.14 975.308 C 1711.03 999.586 1684.89 1012.79 1669.05 1035.61 C 1696.08 1024.28 1720.32 1007.34 1745.56 992.514 C 1749.49 990.208 1755.85 983.949 1759.6 980.729 C 1761.55 982.094 1760.59 981.345 1762.47 982.988 C 1781.1 979.479 1794.04 976.743 1805.72 995.274 C 1806.54 1007.33 1807.21 1015.5 1797.79 1025.25 C 1781.56 1042.05 1756.92 1049.84 1743.66 1070.31 C 1751.73 1066.87 1755.42 1064.42 1762.16 1058.71 C 1762.71 1058.24 1765.18 1058.79 1766.09 1058.91 L 1766.47 1060.15 L 1763.5 1062.89 C 1768.88 1063.86 1769.94 1061.7 1772.01 1064.36 C 1771.33 1075.75 1761.79 1090.25 1756.11 1100.19 C 1755.22 1101.74 1750.32 1102.13 1748.06 1106.41 C 1750.12 1109.01 1750.09 1108.78 1753.18 1110.12 C 1761.34 1110.18 1783.33 1094.9 1790.84 1089.8 C 1781.82 1104.82 1778.14 1108.03 1764.03 1118.37 C 1761.32 1120.35 1762.26 1127.33 1758.71 1130.03 L 1756.39 1128.89 C 1748.83 1134.47 1736.24 1146.75 1728.92 1153.47 C 1732.23 1155.9 1732.82 1155.47 1733.95 1158.61 C 1731.3 1161.64 1732.74 1161.13 1729.64 1161.98 L 1726.43 1158.64 C 1717.97 1159.38 1699.67 1182.35 1692.88 1188.61 C 1698.33 1186.42 1710.43 1182.67 1714.11 1180.04 L 1714.34 1178.32 C 1712.11 1176.6 1711.96 1176.69 1710.35 1174.43 C 1714.93 1172.88 1717.47 1176.55 1719.86 1180.15 C 1729.18 1179.11 1744.21 1177.02 1753.11 1176.83 C 1745.31 1183.6 1715.6 1210.39 1711.76 1218.45 C 1716.01 1220.72 1718.46 1218.89 1719.32 1221 C 1716.14 1223.04 1711.61 1221.84 1707.79 1221.05 C 1703.55 1225.02 1685.56 1242.62 1683.26 1246.92 L 1686.23 1247.95 C 1706.73 1235.5 1725.8 1220.93 1746.24 1208.36 C 1773.05 1191.85 1801.08 1178.05 1828.49 1162.46 C 1854.82 1147.49 1881.14 1132.02 1907.94 1118.01 L 1910.06 1119.86 C 1898.27 1128.63 1887.77 1138.92 1876.24 1147.65 C 1829.31 1183.21 1785.67 1223.89 1739.95 1260.68 C 1750.59 1256.08 1763.68 1246.05 1774.2 1239.96 C 1800.21 1224.82 1826.68 1210.48 1853.57 1196.94 L 1743.19 1289.34 C 1735.08 1296.05 1706.01 1317.58 1701.52 1323.24 C 1723.34 1312.92 1747.43 1294.05 1769.69 1282.74 C 1781.1 1276.94 1788.04 1270.77 1800.96 1266.66 L 1802.2 1266.26 L 1802.95 1266.02 C 1784.87 1286.73 1760.48 1303.16 1739.52 1320.76 C 1687.21 1364.7 1630.84 1403.31 1577.59 1446.14 C 1571.64 1450.92 1565.11 1455.49 1560 1461.17 C 1561.98 1462.94 1561.47 1461.89 1562.26 1464.12 L 1560.53 1465.6 C 1558.39 1464.7 1559.06 1465.09 1557.22 1463.41 C 1546.51 1467.5 1542.14 1472.47 1539.91 1483.36 C 1535.01 1485.34 1536.85 1483.51 1531.54 1482.83 C 1506.38 1500.24 1482.3 1520.09 1457.55 1538.14 C 1456.91 1538.61 1456.52 1541.89 1456.45 1542.72 L 1453.66 1544.98 C 1450.18 1544.44 1451.47 1541.22 1446.87 1544.9 C 1421.05 1565.61 1394.53 1585.4 1367.7 1604.77 C 1365.1 1606.65 1363.86 1614.73 1360.14 1618.04 L 1358.11 1617.94 L 1357.75 1617.34 C 1360.64 1613.7 1362.68 1611.17 1365.19 1607.2 C 1345.37 1619.25 1330.07 1631.85 1311.48 1645.17 L 1211.05 1717.41 C 1201.44 1724.42 1147.44 1765.91 1139.83 1766.75 C 1137.54 1764.59 1138.04 1765.88 1137.73 1763.03 C 1150.3 1746.08 1248.72 1644.5 1248.53 1641.23 C 1243.42 1644.77 1239.13 1649.37 1234.26 1653.25 C 1209.1 1673.31 1182.95 1691.94 1157.62 1711.8 L 1076.43 1776.7 C 1068.53 1782.78 1060.73 1789 1053.05 1795.36 C 1033.15 1812.11 1009.2 1836.15 987.494 1804.42 C 975.141 1786.36 997.814 1767.11 1010.6 1757.59 C 1031.62 1741.94 1050.33 1732.05 1065.22 1710.47 C 1053.51 1718.74 1041.95 1727.22 1030.55 1735.92 C 1024.59 1740.41 1015.62 1747.63 1009.47 1751.12 C 984.797 1742.1 1002.98 1723.11 1011.52 1707.85 L 1010.03 1708.83 C 998.626 1716.42 988.655 1725.5 977.665 1733.5 C 942.965 1758.78 910.468 1787.06 875.628 1812.11 C 866.657 1817.83 859.069 1826.86 850.154 1832.31 C 831.94 1843.46 801.211 1825.69 808.165 1803.56 C 814.122 1784.61 839.475 1768.51 854.516 1756.88 C 867.936 1746.44 881.131 1735.72 894.092 1724.71 L 880.583 1720.73 L 689.943 1868.79 C 661.299 1891.18 632.536 1913.27 603.941 1935.82 C 582.964 1952.37 554.119 1932.32 558.687 1907.14 C 559.224 1904.17 560.611 1898.56 562.75 1896.12 C 616.247 1851.92 676.909 1814.04 725.953 1764.48 C 703.737 1776.5 685.055 1790.45 661.244 1798.61 C 658.876 1793.69 656.52 1789 654.531 1783.9 C 659.196 1778.03 663.357 1773.49 668.425 1768.31 C 673.761 1762.85 694.453 1747.57 695.579 1741.85 L 694.044 1738 L 694.908 1736.44 L 696.601 1736.14 C 697.519 1738.15 697.803 1738.95 699.139 1740.69 C 709.584 1733.76 735.345 1709.85 745.797 1700.78 C 762.379 1686.67 778.747 1672.32 794.894 1657.72 C 799.372 1653.74 816.628 1640.33 817.531 1635.95 L 815.395 1633.01 L 814.515 1633.1 L 813.88 1636.06 C 808.824 1633.05 810.517 1630.51 800.457 1625.13 C 791.759 1629.86 784.552 1637.21 776.808 1643.37 C 755.262 1660.51 733.617 1677.44 712.842 1695.54 C 708.185 1699.6 701.999 1704.05 696.517 1706.91 C 678.517 1704.06 657.883 1694.95 663.277 1672.68 C 668.454 1651.3 691.555 1637.53 706.418 1622.99 C 715.162 1614.63 722.859 1607.01 731.111 1598.44 L 726.995 1596.99 C 728.271 1586.99 740.507 1588.71 742.805 1578.61 C 693.779 1605.92 647.89 1647.22 601.429 1678.9 C 583.981 1690.79 557.843 1719.67 535.922 1695.44 C 530.762 1689.73 528.158 1682.17 528.716 1674.49 C 529.038 1670 531.261 1662.04 534.624 1659.06 C 583.053 1616.1 638.989 1579.65 687.647 1537.2 C 640.742 1561.52 596.673 1596.85 553.774 1627.73 C 501.101 1665.63 449.698 1705.17 397.747 1744.02 C 379.409 1757.74 349.854 1743.98 352.056 1719.98 C 352.572 1714.35 354.313 1709.28 358.14 1705 C 406.69 1662.89 465.25 1629.2 512.853 1586.06 C 504.417 1589.56 482.209 1599.62 476.452 1588.75 C 476.222 1577.1 491.936 1561.36 499.644 1553.22 C 491.73 1556.95 471.295 1573.66 464.868 1566.87 C 463.272 1552.97 516.896 1497.73 528.607 1482.78 C 493.428 1501.89 457.997 1530.44 424.988 1553.49 C 411.472 1563.76 398.437 1572.88 384.334 1582.29 C 357.767 1600.02 325.548 1567.12 346.164 1542.12 C 349.746 1537.77 354.003 1534.23 358.763 1530.98 C 376.511 1518.82 392.857 1505.09 409.564 1491.58 C 397.835 1485.94 393.395 1484.64 392.9 1471.1 C 392.333 1470.7 391.767 1470.3 391.2 1469.91 C 380.654 1475.22 371.898 1485.42 358.808 1484.39 C 336.375 1483.38 326.022 1452.13 343.436 1437.94 C 357.569 1426.42 374.889 1417.6 389.797 1406.5 C 388.003 1390.83 386.875 1380.63 389.388 1365.12 C 374.3 1372.76 361.112 1384.26 344.91 1389.68 C 338.307 1391.88 326.335 1389.59 327.427 1382.8 C 331.452 1357.78 370.946 1337.87 386.928 1319.69 C 391.548 1314.44 394.466 1303.16 400.23 1295.6 C 329.394 1342.44 261.464 1395.46 192.298 1444.76 C 179.15 1454.13 159.484 1453.15 151.272 1437.67 C 139.56 1415.58 155.117 1402.46 172.086 1391.29 C 181.36 1384.85 190.371 1377.58 198.957 1371.2 L 326.542 1276.05 C 348.841 1259.33 371.26 1242.76 392.567 1224.77 C 395.63 1222.19 400.665 1217.43 397.418 1213.62 C 378.453 1208.94 319.236 1269.36 287.402 1279.18 L 285.956 1279.62 C 278.856 1277.45 277.634 1277.11 271.254 1273.24 C 268.512 1268.52 267.559 1265.86 265.655 1260.86 C 270.169 1241.94 276.761 1241.29 286.703 1227.31 L 287.281 1226.48 C 275.408 1236.16 262.479 1244.49 249.925 1253.78 C 225.662 1271.57 202.273 1292.15 176.458 1307.55 C 163.256 1314.71 147.205 1306.9 140.574 1294.81 C 124.116 1264.8 165.091 1247.53 184.981 1232.07 L 241.004 1189.33 C 247.69 1184.18 253.494 1178.14 260.277 1173.58 C 284.784 1157.08 308.637 1138.58 331.762 1120.29 C 314.681 1116.57 310.605 1116.64 304.449 1099.85 C 308.309 1088.99 310.614 1085.88 318.271 1077.87 C 312.027 1072.93 310.168 1070.5 305.372 1064.44 C 299.011 1031.97 318.47 1031.6 333.403 1009.12 C 334.689 1007.19 336.982 999.217 337.766 996.539 C 302.252 1020.79 268.545 1048.57 232.346 1071.25 C 209.485 1085.58 174.292 1048.86 199.431 1026.38 C 211.334 1015.73 224.148 1007.83 236.493 998.131 C 267.196 973.997 300.927 952.368 331.331 928.058 C 317.422 907.838 325.928 893.505 344.156 879.763 C 358.542 868.917 373.546 858.475 387.31 846.837 C 391.567 833.849 394.182 819.943 396.858 806.54 C 379.008 820.715 360.101 833.95 341.267 846.783 C 330.765 853.937 312.863 868.682 302.414 873.972 C 298.271 876.11 293.673 877.217 289.011 877.2 C 264.784 876.905 250.513 844.201 271.875 827.047 C 288.06 814.05 304.111 801.175 320.735 788.643 L 405.831 724.398 C 417.675 715.37 428.016 704.731 439.657 695.259 C 462.733 676.482 485.877 657.759 509 639.04 L 508.101 636.621 C 495.334 647.559 470.917 664.05 456.327 674.688 C 435.596 689.964 414.599 704.878 393.347 719.422 C 381.73 727.411 342.091 760.579 333.455 737.688 C 329.551 727.339 331.467 722.897 335.607 713.717 C 318.659 728.939 275.674 759.952 255.208 766.775 C 239.342 763.001 223.591 753.195 222.957 734.852 C 222.358 717.544 238.638 708.109 250.47 698.835 C 256.844 693.838 263.594 688.766 270.137 683.733 L 398.661 586.552 L 435.124 560.016 C 438.727 557.399 448.646 550.59 451.372 547.689 L 450.964 543.712 C 452.577 540.734 451.483 541.964 454.592 540.109 L 454.337 543.608 L 455.433 543.916 C 459.024 541.795 472.737 532.9 474.407 529.731 L 472.813 527.025 L 473.273 525.591 L 475.104 524.66 L 477.038 528.079 C 482.154 526.791 522.965 494.63 531.339 488.337 C 576.743 454.216 623.765 422.445 669.694 389.037 C 674.258 385.717 677.484 382.168 680.867 377.686 L 682.392 379.581 C 686.247 378.585 763.495 318.755 775.817 311.395 C 822.77 283.349 873.214 237.617 922.539 213.311 C 909.065 224.628 899.591 236.209 887.309 247.214 C 854.84 276.308 824.074 307.183 791.911 336.407 L 793.086 336.922 C 818.2 319.939 844.145 304.484 868.889 286.984 C 871.428 285.189 877.412 282.989 880.401 282.463 C 878.206 285.277 874.714 286.466 872.249 289.138 C 843.411 320.39 809.788 349.41 775.972 375.276 L 778.149 376.066 C 800.969 360.737 823.816 346.209 846.273 330.317 C 864.764 317.231 882.471 302.812 901.006 290.062 C 905.189 289.708 909.254 288.811 912.895 290.636 C 915.269 293.194 915.486 295.851 916.327 299.31 C 906.866 314.422 885.479 334.799 872.814 349.286 C 878.243 346.563 887.101 341.239 892.904 342.229 C 895.418 349.573 864.48 375.531 857.938 380.876 L 859.25 382.696 C 879.214 367.368 901.419 349.432 921.536 334.885 L 976.206 295.243 C 981.315 291.543 997.362 280.869 1000.82 276.962 L 999.561 274.79 L 1000.06 273.911 L 1003.06 275.24 C 1016.92 268.446 1031.46 253.5 1045.65 246.082 C 1050.77 243.406 1058.46 241.457 1061.27 248.111 C 1060.2 267.659 1036.47 284.686 1021.88 299.694 C 1022.04 302.023 1021.62 301.023 1023.09 302.724 C 1070.29 272.489 1114.75 237.563 1160.19 204.77 C 1173.01 195.52 1189.3 180.517 1203.02 174.071 C 1207.08 172.164 1212.13 172.166 1216.44 173.077 C 1223.93 174.659 1231.1 179.559 1235.08 186.124 C 1238.66 192.021 1239.29 199.846 1237.63 206.458 C 1232.4 227.308 1159.81 274.815 1141.5 290.145 L 1142.92 289.542 C 1161.72 281.369 1193.47 252.417 1212.33 253.115 C 1215.53 255.072 1216.65 259.503 1218.17 263.35 C 1209.41 278.665 1172.71 305.02 1158 317.362 C 1142.16 330.596 1126.91 344.52 1112.3 359.094 z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn tool-btn-lg" class:active={$activeToolName === 'saturation'}
        on:click={selectSaturation} title={toolTitle('saturation')}
      >◉</button>
      <button
        class="tool-btn tool-btn-lg" class:active={$activeToolName === 'dodge-burn'}
        on:click={selectDodgeBurn} title={toolTitle('dodgeBurn')}
      >◑</button>
      <button
        class="tool-btn tool-btn-lg" class:active={$activeToolName === 'move'}
        on:click={selectMove} title={toolTitle('move')}
      ><span style="line-height:1">✥</span></button>
      <button
        class="tool-btn tool-btn-lg" class:active={$activeToolName === 'move-layer'}
        on:click={selectMoveLayer} title={toolTitle('moveLayer')}
      ><span style="padding-top: 4px">⤢</span></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'eyedropper'}
        on:click={selectEyedropper} title={toolTitle('eyedropper')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="270 220 1580 1610" class="tool-icon"><path d="M 1484.66 221.017 C 1710.81 214.307 1841.34 464.386 1705.29 640.181 C 1689.86 660.12 1667.97 679.655 1649.87 697.748 L 1584.25 764.03 C 1570.03 778.417 1553.6 794.342 1540.31 809.328 C 1599.12 884.717 1555.84 992.918 1461.54 989.741 C 1416.14 988.212 1397.58 970.591 1367.47 939.77 L 1331.13 902.604 C 1269.92 961.5 1208.86 1023.75 1148.74 1083.81 L 929.894 1301.53 C 852.789 1378.67 786.281 1434.87 668.165 1438.91 C 652.847 1439.43 637.989 1438.01 622.561 1438.97 C 606.691 1451.73 574.758 1486.88 559.064 1503.34 C 529.494 1534.05 502.495 1575.13 457.815 1582.45 C 386.454 1595.05 319.888 1517.67 355.856 1450.86 C 372.397 1420.13 436.42 1363.91 464.507 1333.17 C 473.437 1323.39 487.001 1312.47 494.534 1301.95 C 502.259 1191.65 561.954 1121.75 635.273 1048.33 L 1054.4 628.241 C 1034.03 601.569 1003.9 586.278 992.51 551.552 C 954.451 445.975 1088.53 359.145 1170.82 440.457 C 1274.22 342.711 1334.51 237.142 1484.66 221.017 z M 598.614 1373.65 C 736.907 1388.25 784.46 1358.59 883.724 1259.58 L 1179.66 962.889 C 1214.25 928.65 1252.46 893.738 1285.8 858.407 C 1281.14 852.608 1275.97 847.142 1270.22 842.406 C 1253.14 863.395 1219.38 894.863 1199.54 914.807 L 900.148 1214.46 C 827.104 1287.58 764.011 1355.36 653.122 1352.34 C 640.776 1352 620.192 1350.45 608.815 1351.89 L 607.214 1352.1 L 608.159 1351.64 C 617.952 1347.03 631.275 1342.11 641.787 1339.22 C 699.51 1323.39 729.385 1289.94 769.817 1249.37 L 1093.3 924.013 C 1130.67 886.309 1182.68 827.736 1221.84 794.574 C 1182.57 753.989 1140.15 711.991 1099.83 672.464 L 791.341 979.93 C 761.39 1009.38 731.73 1038.94 702.477 1069.05 C 624.82 1148.99 556.935 1205.67 553.515 1330.87 C 508.154 1377.73 461.182 1423.19 417.592 1471.79 C 399.53 1491.93 419.426 1525.24 445.379 1522.73 C 466.553 1520.73 578.779 1393.7 598.614 1373.65 z M 1084.69 469.224 C 1049.72 480.842 1031.42 516.914 1060 547.093 C 1074.46 562.354 1089.75 577.219 1104.71 592.105 L 1354.06 838.61 C 1379.57 863.912 1433.3 933.466 1468.68 928.336 C 1504.41 918.937 1521.44 879.848 1495.25 852.761 C 1449.37 805.305 1401.06 759.778 1354.39 713.073 L 1179.37 537.708 C 1151.99 510.483 1124.44 465.674 1084.69 469.224 z M 1214.05 485.479 L 1332.03 604.548 C 1360.91 633.876 1395.38 669.851 1425.64 697.376 C 1468.08 638.746 1543.6 590.047 1588.79 530.68 C 1640.19 463.146 1636.52 381.173 1578.11 321.004 C 1662.27 362.094 1699.87 474.953 1656.73 558.499 C 1634.56 601.426 1552.24 674.422 1513.41 714.832 C 1502.26 726.705 1487.94 738.591 1477.4 750.705 L 1493.31 766.183 C 1510.02 747.389 1536.55 723.286 1555.07 704.986 L 1617.62 642.831 C 1668.3 592.512 1698.62 558.575 1698.38 479.689 C 1697.97 342.227 1561.77 244.706 1431.71 292.99 C 1374.91 314.078 1349.73 348.898 1308.86 389.918 L 1214.05 485.479 z" fill="currentColor"/><path d="M 1221.84 794.574 C 1238.39 812.055 1252.67 825.995 1270.22 842.406 C 1253.14 863.395 1219.38 894.863 1199.54 914.807 L 900.148 1214.46 C 827.104 1287.58 764.011 1355.36 653.122 1352.34 C 640.776 1352 620.192 1350.45 608.815 1351.89 L 607.214 1352.1 L 608.159 1351.64 C 617.952 1347.03 631.275 1342.11 641.787 1339.22 C 699.51 1323.39 729.385 1289.94 769.817 1249.37 L 1093.3 924.013 C 1130.67 886.309 1182.68 827.736 1221.84 794.574 z" fill="currentColor"/><path d="M 1578.11 321.004 C 1662.27 362.094 1699.87 474.953 1656.73 558.499 C 1634.56 601.426 1552.24 674.422 1513.41 714.832 C 1502.26 726.705 1487.94 738.591 1477.4 750.705 C 1462.63 733.618 1441.82 715.768 1425.64 697.376 C 1468.08 638.746 1543.6 590.047 1588.79 530.68 C 1640.19 463.146 1636.52 381.173 1578.11 321.004 z" fill="currentColor"/><path d="M 370.83 1583.07 C 400.523 1582.41 447.011 1674.47 457.421 1698.42 C 482.647 1756.45 443.779 1818.14 380.275 1823.78 C 340.315 1825.06 309.466 1806.45 293.099 1770.05 C 270.65 1720.12 299.096 1687.31 324.531 1646.7 C 336.318 1627.88 352.26 1590.88 370.83 1583.07 z" fill="currentColor"/><path d="M 377.568 1626.71 C 381.009 1628.93 421.166 1696.19 425.826 1705.06 C 447.171 1745.73 422.773 1787.67 377.568 1793.07 C 334.363 1793.62 304.734 1748.87 322.048 1712.42 C 332.779 1689.82 360.905 1644.12 377.568 1626.71 z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'fill'}
        on:click={selectFill} title={toolTitle('fill')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" class="tool-icon">
        <defs>
          <clipPath id="fill-tool-clip">
            <rect x="0" y="0" width="250" height="105"/>
          </clipPath>
        </defs>
        <!-- bucket (upper area): gray fill clipped to y < 155 -->
        <path fill="currentColor" clip-path="url(#fill-tool-clip)" d="m235.6 197.5c-2.23-7.81-14.75-8.8-23.02-10.88-3.78-0.98-8.64-1.9-8.1-3.3s3.42-1.13 2.94-5.02c-0.47-3.88-8.48-8.11-38.02-10.92-6.67-0.63-13.86-1.09-19.34-1.48-2.36-9.2-1.15-30.77-14.35-58.7-1.35-2.13-2.63-3.95-3.39-4.01 6.89-8.3 18.85-28.9 14.24-46.87-0.62-2.42-1.78-4.37-1.78-5.18 0-10.23-10.98-26.32-24.18-24.63-2.3 0.31-4.09 0.18-5.62 1.31l-27.08-19.84c-3.12-2.41-6.92-2.49-9.92-2.09-16.56 1.18-40.06 21.29-47.84 48.98-2.42 9.05-1.33 17.13 3.67 20.85l46.14 42.13c4.53 6.21 8.31 8.28 14.44 8.37 4.59 10.12 5.52 27.2 5.08 39.29-7.76 0.7-17.97 1.56-25.31 2.51-18.25 2.5-49.79 6.78-57.96 16.36-3.97 3.79-4.39 9.15 2.95 12.92 6.63 3.39 13.01 4.45 18.77 6.64 2.23 0.98 2.76 1.41 0.29 4.13-4.11 4.61-2.47 9.87 3.89 13.2 6.35 3.33 18.17 5.17 29.73 5.47 9.2-0.3 15.25-1.38 21.43-0.67 7.64 0.87 13.53 6.57 24.55 10.38 10.95 3.47 24.95 5.05 40.49 3.94 16.26-1.15 31.22-6.46 33.97-12.89 2.39-5.8-1.89-8.67-0.64-11.87 1.48-3.59 10.22-4.71 14.97-5 7.13-0.41 24.15-3.35 28.26-9.96 0.93-1.82 1.05-2.34 0.74-3.17zm-117.7-168.7c10.25-1.65 19.77 8.04 22 16.37-2.77-4.12-5.47-3.45-8.6-4.77-3.48-1.44-6.68-7.91-13.4-10.09-1.01-0.34-1.81-1.1 0-1.51zm-44.76 77.19c-7.05-4.46-5.89-20.22 1.89-34.45 4.89-8.78 11.99-16.84 14.94-22.47 1.11-2.26-2.48-0.28-3.27-1.11 0.45-2.57 13.56-11.95 17.46-14.26-1.9-0.11-23.86 6.19-33.39 24.41-3.57 6.8-4.58 12.98-4.63 19.73-6.52-4.14-13.62-10.14-20.34-20.66-3.07 5.91-4.05 13.46-3.48 21.78l-6.94-5.76c-6.27-6.27-3.75-18.99 1.74-30.97 10.08-20.23 27.1-34.14 40.11-34.48 4.45-0.12 6.75 0.49 9.47 2.94l24.95 18.38-1.53 1.37-18.69-13.73c-2.41-1.72-3.57 1.01-2.41 2.13l17.9 13.6c-6.89 5.26-16.18 16.51-18.22 21.55-2.62 6.08 0 9.9 2.73 10.17 2.89 0.29 5.9-2.15 5.7-5.97-0.1-3.04 0.39-8.7 2.29-13-3.1 2.2-6.12 6.4-7.28 10.3-1.64 5.33 0.39 6.6 1.83 6.52 2.88-0.2 3.16-3.35 3.16-4.91 0-4.01 1-10.19 2.44-14.11 3.32-4.16 7.64-8.07 11.67-10.3 3.57-1.58 7.68-0.89 11.34 2.23 3.15 2.74 5.32 5.48 10.52 7.8-10.71-0.15-27.88 10.24-38.88 26.87-10.44 15.81-16.7 32.42-14.13 44.32l-6.95-7.92zm56.96-4.6-0.8-0.95c9.14-12.2 15.13-30.3 12.18-42.33-4.06-13.47-16.86-12.02-25.54-6.06-16.42 10.89-24.76 25.85-28.92 41.84-3.68 13.6-1.29 23.18 5.9 29.02v1.18c-6.5-1.05-9.2-7.95-10.58-14.59-1.39-11.8 5.08-27.2 13.76-39.43 9.03-12.67 20.13-22.08 31.03-22.96 8.67-0.74 15.57 4.28 17.8 13.68 3 12.97-5.7 30.27-14.83 40.6zm8.68-44.92c5.31 9.67-0.86 28.69-9.48 42.3-4.23-7.73-9.23-13.13-14.56-15.68 3.78-3.3 8.04-8.93 9.73-14.2-0.44 6.61-2.34 10.03-3.98 15.21 5-5.59 8.93-12.05 11.16-19.66l-0.66 10.3 4.95-11.95-4.29 18.91c5.43-7.61 8.25-16.66 7.13-25.23z"/>
        <!-- full outline (bucket + paint pool): stroke only so pool is hollow -->
        <path fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round" d="m235.6 197.5c-2.23-7.81-14.75-8.8-23.02-10.88-3.78-0.98-8.64-1.9-8.1-3.3s3.42-1.13 2.94-5.02c-0.47-3.88-8.48-8.11-38.02-10.92-6.67-0.63-13.86-1.09-19.34-1.48-2.36-9.2-1.15-30.77-14.35-58.7-1.35-2.13-2.63-3.95-3.39-4.01 6.89-8.3 18.85-28.9 14.24-46.87-0.62-2.42-1.78-4.37-1.78-5.18 0-10.23-10.98-26.32-24.18-24.63-2.3 0.31-4.09 0.18-5.62 1.31l-27.08-19.84c-3.12-2.41-6.92-2.49-9.92-2.09-16.56 1.18-40.06 21.29-47.84 48.98-2.42 9.05-1.33 17.13 3.67 20.85l46.14 42.13c4.53 6.21 8.31 8.28 14.44 8.37 4.59 10.12 5.52 27.2 5.08 39.29-7.76 0.7-17.97 1.56-25.31 2.51-18.25 2.5-49.79 6.78-57.96 16.36-3.97 3.79-4.39 9.15 2.95 12.92 6.63 3.39 13.01 4.45 18.77 6.64 2.23 0.98 2.76 1.41 0.29 4.13-4.11 4.61-2.47 9.87 3.89 13.2 6.35 3.33 18.17 5.17 29.73 5.47 9.2-0.3 15.25-1.38 21.43-0.67 7.64 0.87 13.53 6.57 24.55 10.38 10.95 3.47 24.95 5.05 40.49 3.94 16.26-1.15 31.22-6.46 33.97-12.89 2.39-5.8-1.89-8.67-0.64-11.87 1.48-3.59 10.22-4.71 14.97-5 7.13-0.41 24.15-3.35 28.26-9.96 0.93-1.82 1.05-2.34 0.74-3.17z"/>
      </svg></button>
      <div class="sidebar-divider" />
      <button
        class="tool-btn" class:active={$activeToolName === 'rect-select'}
        on:click={selectRectSelect} title={toolTitle('rectSelect')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" class="tool-icon"><path d="m12.16 8.71h0.58c2.95 0 3.57 2 3.57 3.93 0 2.07-0.71 4.25-3.73 4.25h-0.42c-3.03 0-3.59-2.18-3.59-4.25 0-1.93 0.74-3.93 3.59-3.93z" fill="currentColor"/><path d="m27.98 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.09-3.63-4.04 0-1.89 0.81-3.93 3.67-3.93z" fill="currentColor"/><path d="m44.97 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.87 4.04h-0.42c-3.03 0-3.63-2.09-3.63-4.04 0-1.89 0.8-3.93 3.66-3.93z" fill="currentColor"/><path d="m60.91 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.88 4.04h-0.42c-3.02 0-3.63-2.09-3.63-4.04 0-1.89 0.81-3.93 3.67-3.93z" fill="currentColor"/><path d="m76.84 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.87 4.04h-0.42c-3.03 0-3.64-2.09-3.64-4.04 0-1.89 0.81-3.93 3.67-3.93z" fill="currentColor"/><path d="m92.77 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.09-3.63-4.04 0-1.89 0.81-3.93 3.67-3.93z" fill="currentColor"/><path d="m108.7 8.79h0.57c3.17 0 3.69 2.32 3.69 3.93 0 1.95-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.09-3.63-4.04 0-1.89 0.81-3.93 3.67-3.93z" fill="currentColor"/><path d="m124.2 8.71h0.57c2.95 0 3.58 2.36 3.58 4.01 0 1.99-0.89 4.04-3.84 4.04h-0.42c-2.95 0-3.67-2.05-3.67-4.04 0-1.93 0.93-4.01 3.78-4.01z" fill="currentColor"/><path d="m140.6 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.05-3.63-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m156.5 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.05-3.63-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m172.4 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.42c-3.03 0-3.64-2.05-3.64-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m188.4 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.42c-3.03 0-3.64-2.05-3.64-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m204.6 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.05-3.63-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m221.4 8.71h0.57c3.17 0 3.69 2.36 3.69 4.01 0 1.99-0.85 4.04-3.87 4.04h-0.43c-3.02 0-3.63-2.05-3.63-4.04 0-1.93 0.81-4.01 3.67-4.01z" fill="currentColor"/><path d="m237.7 8.71h0.57c2.86 0 3.43 2.08 3.43 3.93 0 2.07-0.77 4.12-3.79 4.12h-0.42c-2.86 0-3.51-2.05-3.51-4.12 0-1.93 0.81-3.93 3.72-3.93z" fill="currentColor"/><path d="m238 23.82h0.25c3.02 0 3.51 2.23 3.51 3.84v0.78c0 1.99-1.56 3.68-3.76 3.68h-0.24c-2.66 0-3.76-1.69-3.76-3.68v-0.74c0-1.94 1.14-3.88 4-3.88z" fill="currentColor"/><path d="m12.36 23.82h0.25c3.21 0 3.7 2.14 3.7 3.84v0.78c0 1.99-1.56 3.68-3.76 3.68h-0.24c-2.66 0-3.76-1.69-3.76-3.68v-0.74c0-1.94 0.95-3.88 3.81-3.88z" fill="currentColor"/><path d="m12.17 40.74h0.57c3.03 0 3.57 2.13 3.57 3.83v0.78c0 1.99-1.56 3.56-3.77 3.56h-0.24c-2.66 0-3.72-1.57-3.72-3.56v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m12.17 56.71h0.57c3.03 0 3.57 2.05 3.57 3.74v0.78c0 1.99-1.56 3.48-3.77 3.48h-0.24c-2.66 0-3.72-1.49-3.72-3.48v-0.74c0-1.93 0.89-3.78 3.59-3.78z" fill="currentColor"/><path d="m12.17 73.09h0.57c3.03 0 3.57 2.09 3.57 3.78v0.78c0 1.99-1.56 3.44-3.77 3.44h-0.24c-2.66 0-3.72-1.45-3.72-3.44v-0.74c0-1.93 0.89-3.82 3.59-3.82z" fill="currentColor"/><path d="m12.17 89.47h0.57c3.03 0 3.57 2.05 3.57 3.74v0.78c0 1.99-1.56 3.4-3.77 3.4h-0.24c-2.66 0-3.72-1.41-3.72-3.4v-0.74c0-1.93 0.89-3.78 3.59-3.78z" fill="currentColor"/><path d="m12.17 105.4h0.57c3.03 0 3.57 2.13 3.57 3.83v0.78c0 1.99-1.56 3.47-3.77 3.47h-0.24c-2.66 0-3.72-1.48-3.72-3.47v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m12.17 121h0.57c3.03 0 3.57 2.22 3.57 3.83v0.78c0 1.99-1.56 3.48-3.77 3.48h-0.24c-2.66 0-3.72-1.49-3.72-3.48v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m12.17 136.9h0.57c3.03 0 3.57 2.05 3.57 3.74v0.78c0 1.99-1.56 3.56-3.77 3.56h-0.24c-2.66 0-3.72-1.57-3.72-3.56v-0.74c0-1.93 0.89-3.78 3.59-3.78z" fill="currentColor"/><path d="m12.17 153.1h0.57c3.03 0 3.57 2.09 3.57 3.79v0.78c0 1.99-1.56 3.4-3.77 3.4h-0.24c-2.66 0-3.72-1.41-3.72-3.4v-0.74c0-1.93 0.89-3.83 3.59-3.83z" fill="currentColor"/><path d="m12.17 169.2h0.57c3.03 0 3.57 2.14 3.57 3.83v0.78c0 1.99-1.56 3.48-3.77 3.48h-0.24c-2.66 0-3.72-1.49-3.72-3.48v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m12.17 185.6h0.57c3.03 0 3.57 2.14 3.57 3.83v0.78c0 1.99-1.56 3.48-3.77 3.48h-0.24c-2.66 0-3.72-1.49-3.72-3.48v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m12.17 201.1h0.57c3.03 0 3.57 2.13 3.57 3.82v0.78c0 1.99-1.56 3.48-3.77 3.48h-0.24c-2.66 0-3.72-1.49-3.72-3.48v-0.74c0-1.93 0.89-3.86 3.59-3.86z" fill="currentColor"/><path d="m12.17 216.6h0.57c3.03 0 3.57 2.13 3.57 3.82v0.79c0 1.99-1.56 3.47-3.77 3.47h-0.24c-2.66 0-3.72-1.48-3.72-3.47v-0.75c0-1.93 0.89-3.86 3.59-3.86z" fill="currentColor"/><path d="m12.17 233.3h0.57c3.03 0 3.57 2.22 3.57 3.83v0.78c0 1.99-1.56 3.44-3.77 3.44h-0.24c-2.66 0-3.72-1.45-3.72-3.44v-0.74c0-1.93 0.89-3.87 3.59-3.87z" fill="currentColor"/><path d="m237.4 40.74h0.25c3.02 0 3.55 2.13 3.55 3.83v0.78c0 1.99-1.56 3.56-3.76 3.56h-0.24c-2.5 0-3.68-1.57-3.68-3.56v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 56.71h0.25c3.02 0 3.55 2.05 3.55 3.74v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.78 3.88-3.78z" fill="currentColor"/><path d="m237.4 73.09h0.25c3.02 0 3.55 2.09 3.55 3.78v0.78c0 1.99-1.56 3.44-3.76 3.44h-0.24c-2.5 0-3.68-1.45-3.68-3.44v-0.74c0-1.93 1.02-3.82 3.88-3.82z" fill="currentColor"/><path d="m237.4 89.14h0.25c3.02 0 3.55 2.14 3.55 3.83v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 105.4h0.25c3.02 0 3.55 2.13 3.55 3.83v0.78c0 1.99-1.56 3.47-3.76 3.47h-0.24c-2.5 0-3.68-1.48-3.68-3.47v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 121h0.25c3.02 0 3.55 2.22 3.55 3.83v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 136.9h0.25c3.02 0 3.55 2.05 3.55 3.74v0.78c0 1.99-1.56 3.56-3.76 3.56h-0.24c-2.5 0-3.68-1.57-3.68-3.56v-0.74c0-1.93 1.02-3.78 3.88-3.78z" fill="currentColor"/><path d="m237.4 153.1h0.25c3.02 0 3.55 2.09 3.55 3.79v0.78c0 1.99-1.56 3.4-3.76 3.4h-0.24c-2.5 0-3.68-1.41-3.68-3.4v-0.74c0-1.93 1.02-3.83 3.88-3.83z" fill="currentColor"/><path d="m237.4 169.2h0.25c3.02 0 3.55 2.14 3.55 3.83v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 185.6h0.25c3.02 0 3.55 2.14 3.55 3.83v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.87 3.88-3.87z" fill="currentColor"/><path d="m237.4 201.1h0.25c3.02 0 3.55 2.13 3.55 3.82v0.78c0 1.99-1.56 3.48-3.76 3.48h-0.24c-2.5 0-3.68-1.49-3.68-3.48v-0.74c0-1.93 1.02-3.86 3.88-3.86z" fill="currentColor"/><path d="m237.4 216.6h0.25c3.02 0 3.55 2.13 3.55 3.82v0.79c0 1.99-1.56 3.47-3.76 3.47h-0.24c-2.5 0-3.68-1.48-3.68-3.47v-0.75c0-1.93 1.02-3.86 3.88-3.86z" fill="currentColor"/><path d="m237.4 233.6h0.25c3.02 0 3.55 2.13 3.55 3.82v0.79c0 1.99-1.56 3.47-3.76 3.47h-0.24c-2.5 0-3.68-1.48-3.68-3.47v-0.75c0-1.93 1.02-3.86 3.88-3.86z" fill="currentColor"/><path d="m28.11 233.3h0.57c2.94 0 3.66 2.35 3.66 4v0.38c0 2.08-1.43 4.03-4.01 4.03h-0.42c-2.86 0-3.67-1.95-3.67-4.03 0-2.03 0.89-4.38 3.87-4.38z" fill="currentColor"/><path d="m44.83 233.3h0.58c2.94 0 3.66 2.35 3.66 4v0.38c0 2.08-1.61 3.67-3.78 3.67h-0.42c-2.86 0-3.67-1.59-3.67-3.67 0-2.03 0.89-4.38 3.63-4.38z" fill="currentColor"/><path d="m60.67 233.3h0.58c2.94 0 3.66 1.94 3.66 3.69v0.74c0 1.99-1.6 3.47-3.78 3.47h-0.42c-2.85 0-3.66-1.48-3.66-3.47 0-2.03 0.88-4.43 3.62-4.43z" fill="currentColor"/><path d="m76.37 233.6h0.57c2.95 0 3.67 2.02 3.67 3.68v0.38c0 2.07-1.6 3.67-3.78 3.67h-0.42c-2.5 0-3.68-1.6-3.68-3.67 0-2.04 1.1-4.06 3.64-4.06z" fill="currentColor"/><path d="m92.66 233.6h0.57c2.94 0 3.66 2.02 3.66 3.68v0.38c0 2.07-1.6 3.67-3.78 3.67h-0.42c-2.5 0-3.68-1.6-3.68-3.67 0-2.04 1.1-4.06 3.65-4.06z" fill="currentColor"/><path d="m108.4 233.6h0.57c2.94 0 3.66 2.02 3.66 3.68v0.38c0 2.07-1.6 3.67-3.78 3.67h-0.42c-2.5 0-3.68-1.6-3.68-3.67 0-2.04 1.1-4.06 3.65-4.06z" fill="currentColor"/><path d="m124 233.3h0.57c2.94 0 3.66 2.02 3.66 3.69v0.65c0 2.07-1.78 3.72-3.95 3.72h-0.42c-2.5 0-3.68-1.65-3.68-3.72 0-2.03 1.1-4.34 3.82-4.34z" fill="currentColor"/><path d="m140.6 233.6h0.57c2.94 0 3.66 2.02 3.66 3.68v0.38c0 2.07-1.6 3.67-3.78 3.67h-0.42c-2.5 0-3.68-1.6-3.68-3.67 0-2.04 1.1-4.06 3.65-4.06z" fill="currentColor"/><path d="m156.5 233.6h0.57c2.74 0 3.78 2.02 3.78 3.68v0.74c0 1.99-1.68 3.66-3.86 3.66h-0.65c-2.42 0-3.85-1.94-3.85-4.02 0-2.04 1.27-4.06 4.01-4.06z" fill="currentColor"/><path d="m172.5 233.6h0.57c2.74 0 3.78 2.02 3.78 3.68v0.74c0 1.99-1.42 3.66-3.86 3.66h-0.65c-2.43 0-3.61-1.67-3.61-3.66 0-2.08 1.1-4.42 3.77-4.42z" fill="currentColor"/><path d="m188.3 233.3h0.57c2.74 0 3.78 2.02 3.78 3.69v0.65c0 2.07-1.38 3.72-3.92 3.72h-0.57c-2.44 0-3.58-1.65-3.58-3.72 0-2.03 1.1-4.34 3.72-4.34z" fill="currentColor"/><path d="m204.4 233.6h0.57c2.74 0 3.78 2.02 3.78 3.68v0.74c0 1.99-1.38 3.66-3.92 3.66h-0.57c-2.43 0-3.6-1.67-3.6-3.66 0-2.08 1.1-4.42 3.74-4.42z" fill="currentColor"/><path d="m220.8 233.6h0.57c2.74 0 3.78 2.02 3.78 3.68v0.74c0 1.99-1.37 3.66-3.92 3.66h-0.57c-2.43 0-3.61-1.67-3.61-3.66 0-2.08 1.1-4.42 3.75-4.42z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'lasso-select'}
        on:click={selectLasso} title={toolTitle('lasso')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" class="tool-icon"><path d="m29.42 129.9c0-0.78 0.62-1.1 1.07-1.1 0.69 0 1.04 0.62 1.04 1.08 0 0.6-0.45 1.21-1.04 1.21-0.67 0-1.07-0.63-1.07-1.19z" fill="currentColor" transform="translate(1,3)"/><path d="m31.48 140.1c0-1.13 0.83-1.55 1.45-1.55 0.94 0 1.45 0.83 1.45 1.5 0 0.87-0.71 1.58-1.47 1.58-0.9 0-1.43-0.85-1.43-1.53z" fill="currentColor"/><path d="m33.31 147.9c0-1.15 0.97-1.64 1.6-1.64 1 0 1.6 0.94 1.6 1.69 0 0.96-0.83 1.67-1.63 1.67-1.01 0-1.57-0.97-1.57-1.72z" fill="currentColor"/><path d="m35.91 155.6c0-1.4 1.15-2 1.98-2 1.26 0 2.02 1.13 2.02 2.12 0 1.21-1.03 2.09-2.04 2.09-1.28 0-1.96-1.28-1.96-2.21z" fill="currentColor"/><path d="m39.78 163.1c0-1.56 1.26-2.27 2.19-2.27 1.45 0 2.34 1.35 2.34 2.5 0 1.41-1.23 2.39-2.36 2.39-1.46 0-2.17-1.48-2.17-2.62z" fill="currentColor"/><path d="m43.76 169.7c0-1.51 1.31-2.27 2.27-2.27 1.53 0 2.44 1.45 2.44 2.61 0 1.46-1.3 2.47-2.46 2.47-1.53 0-2.25-1.56-2.25-2.81z" fill="currentColor"/><path d="m47.96 175.6c0-1.56 1.41-2.34 2.42-2.34 1.6 0 2.54 1.5 2.54 2.74 0 1.55-1.43 2.61-2.59 2.61-1.62 0-2.37-1.62-2.37-3.01z" fill="currentColor"/><path d="m52.18 180.8c0-1.67 1.48-2.51 2.56-2.51 1.72 0 2.73 1.61 2.73 2.94 0 1.7-1.55 2.81-2.78 2.81-1.7 0-2.51-1.73-2.51-3.24z" fill="currentColor"/><path d="m59.47 185.9c0-2 1.65-3.02 2.89-3.02 1.98 0 3.09 1.86 3.09 3.39 0 1.91-1.73 3.17-3.14 3.17-1.99 0-2.84-1.98-2.84-3.54z" fill="currentColor"/><path d="m65.04 189.2c0-2.05 1.78-3.11 3.11-3.11 2.13 0 3.33 2.01 3.33 3.64 0 2.03-1.84 3.29-3.35 3.29-2.12 0-3.09-2.13-3.09-3.82z" fill="currentColor"/><path d="m120.2 124.9c0-2.42 2.06-3.71 3.59-3.71 2.49 0 3.88 2.39 3.88 4.3 0 2.46-2.17 3.94-3.9 3.94-2.46 0-3.57-2.39-3.57-4.53z" fill="currentColor"/><path d="m123.6 116.6c0-2.19 1.8-3.35 3.13-3.35 2.13 0 3.28 1.98 3.28 3.56 0 2.05-1.77 3.31-3.23 3.31-2.1 0-3.18-1.95-3.18-3.52z" fill="currentColor"/><path d="m125.1 109.1c0-1.98 1.6-3.04 2.81-3.04 1.93 0 2.97 1.8 2.97 3.26 0 1.83-1.6 3.04-2.95 3.04-1.93 0-2.83-1.82-2.83-3.26z" fill="currentColor"/><path d="m127.6 102.1c0-1.98 1.6-3.04 2.81-3.04 1.93 0 2.97 1.8 2.97 3.26 0 1.83-1.6 3.04-2.95 3.04-1.93 0-2.83-1.82-2.83-3.26z" fill="currentColor"/><path d="m130.2 93.92c0-2.19 1.78-3.35 3.11-3.35 2.12 0 3.3 1.98 3.3 3.56 0 2.05-1.84 3.32-3.3 3.32-2.14 0-3.11-2.11-3.11-3.53z" fill="currentColor"/><path d="m133.7 86.45c0-2.07 1.75-3.18 3.06-3.18 2.1 0 3.25 1.98 3.25 3.56 0 2.05-1.82 3.31-3.27 3.31-2.1 0-3.04-1.95-3.04-3.69z" fill="currentColor"/><path d="m136.4 79.16c0-2.2 1.83-3.36 3.21-3.36 2.19 0 3.4 2.02 3.4 3.65 0 2.12-1.93 3.38-3.4 3.38-2.15 0-3.21-2.1-3.21-3.67z" fill="currentColor"/><path d="m141.3 72.28c0-2.07 1.73-3.18 3.01-3.18 2.05 0 3.21 1.84 3.21 3.35 0 2.02-1.79 3.23-3.22 3.23-2.05 0-3-1.96-3-3.4z" fill="currentColor"/><path d="m146.3 65.8c0-2.07 1.73-3.18 3.02-3.18 2.05 0 3.21 1.88 3.21 3.39 0 2.02-1.79 3.23-3.22 3.23-2.05 0-3.01-1.96-3.01-3.44z" fill="currentColor"/><path d="m150.9 60.83c0-2.19 1.88-3.35 3.26-3.35 2.24 0 3.48 1.98 3.48 3.56 0 2.18-1.95 3.44-3.5 3.44-2.22 0-3.24-2.07-3.24-3.65z" fill="currentColor"/><path d="m158.1 55.96c0-2.19 1.88-3.35 3.26-3.35 2.24 0 3.48 1.98 3.48 3.56 0 2.18-1.94 3.44-3.49 3.44-2.24 0-3.25-2.08-3.25-3.65z" fill="currentColor"/><path d="m165.1 52.88c0-2.41 2.05-3.7 3.58-3.7 2.42 0 3.81 2.29 3.81 4.2 0 2.39-2.15 3.89-3.85 3.89-2.4 0-3.54-2.39-3.54-4.39z" fill="currentColor"/><path d="m173.1 51.72c0-2.41 2.05-3.7 3.58-3.7 2.42 0 3.81 2.29 3.81 4.2 0 2.39-2.1 3.89-3.8 3.89-2.41 0-3.59-2.34-3.59-4.39z" fill="currentColor"/><path d="m182.7 51.72c0-1.98 1.6-3.04 2.81-3.04 1.93 0 2.97 1.8 2.97 3.26 0 1.83-1.6 3.04-2.95 3.04-1.93 0-2.83-1.82-2.83-3.26z" fill="currentColor"/><path d="m190 53.35c0-1.83 1.5-2.84 2.68-2.84 1.86 0 2.92 1.75 2.92 3.16 0 1.81-1.62 2.97-2.95 2.97-1.84 0-2.65-1.75-2.65-3.29z" fill="currentColor"/><path d="m189.8 61.29c0-2.08 1.73-3.19 3.02-3.19 2.05 0 3.15 1.91 3.15 3.41 0 2-1.77 3.26-3.2 3.26-2.03 0-2.97-1.96-2.97-3.48z" fill="currentColor" transform="translate(-90,112)"/><path d="m215.6 66.19c1.1 0 1.79 1.07 1.79 1.99 0 1.14-1.06 1.85-1.82 1.85-1.09 0-1.57-1.21-1.57-2.17 0-1.07 0.99-1.67 1.6-1.67z" fill="currentColor"/><path d="m206.5 58.85c1.41 0 2.25 1.38 2.25 2.54 0 1.38-1.33 2.27-2.32 2.27-1.38 0-2.09-1.43-2.09-2.64 0-1.36 1.21-2.17 2.16-2.17z" fill="currentColor"/><path d="m200 54.18c1.65 0 2.59 1.61 2.59 2.85 0 1.58-1.5 2.59-2.64 2.59-1.56 0-2.34-1.61-2.34-2.9 0-1.64 1.4-2.54 2.39-2.54z" fill="currentColor"/><path d="m133.1 116.9c0-2.64 2.22-4 3.87-4 2.59 0 4.05 2.46 4.05 4.47 0 2.59-2.27 4.18-4.08 4.18-2.64 0-3.84-2.53-3.84-4.65z" fill="currentColor" transform="translate(-16,16)"/><path d="m114 141.1c0-2.37 1.98-3.6 3.46-3.6 2.34 0 3.62 2.24 3.62 4.05 0 2.29-2.05 3.72-3.64 3.72-2.34 0-3.44-2.24-3.44-4.17z" fill="currentColor"/><path d="m112 149.8c0-2.42 2.05-3.71 3.58-3.71 2.42 0 3.81 2.29 3.81 4.2 0 2.39-2.1 3.89-3.8 3.89-2.41 0-3.59-2.34-3.59-4.38z" fill="currentColor"/><path d="m108.7 156.9c0-2.42 2.06-3.71 3.59-3.71 2.42 0 3.81 2.29 3.81 4.2 0 2.39-2.13 3.89-3.83 3.89-2.41 0-3.57-2.34-3.57-4.38z" fill="currentColor"/><path d="m103.4 166.4c0-2.64 2.22-4 3.87-4 2.59 0 4.05 2.46 4.05 4.47 0 2.59-2.27 4.18-4.08 4.18-2.64 0-3.84-2.53-3.84-4.65z" fill="currentColor"/><path d="m95.33 179c0-2.15 1.75-3.31 3.06-3.31 2.1 0 3.26 1.98 3.26 3.55 0 2.05-1.77 3.32-3.23 3.32-2.1 0-3.09-1.98-3.09-3.56z" fill="currentColor"/><path d="m88.79 184.2c0-2.08 1.8-3.19 3.12-3.19 2.05 0 3.21 1.88 3.21 3.41 0 2.03-1.77 3.29-3.23 3.29-2.1 0-3.1-1.98-3.1-3.51z" fill="currentColor"/><path d="m81.27 187.4c0-2 1.68-3.09 2.97-3.09 2 0 3.13 1.86 3.13 3.39 0 2-1.75 3.26-3.16 3.26-2 0-2.94-1.98-2.94-3.56z" fill="currentColor"/><path d="m72.31 188.9c0-2.36 1.96-3.62 3.45-3.62 2.36 0 3.69 2.17 3.69 3.98 0 2.34-2.05 3.77-3.75 3.77-2.34 0-3.39-2.27-3.39-4.13z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" class:active={$activeToolName === 'magic-wand'}
        on:click={selectMagicWand} title={toolTitle('magicWand')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" class="tool-icon"><path d="M 1290 541.556 L 1423.21 462.962 C 1442.01 452.006 1461.53 439.794 1480.64 430.573 C 1498.19 422.104 1522.61 442.555 1519.16 460.593 C 1515.28 480.893 1507.84 503.079 1502.17 522.877 L 1479.7 604.007 C 1473.09 627.024 1464.84 652.659 1459.18 675.522 C 1506.72 706.676 1584.51 768.573 1621.98 806.465 C 1642.38 827.098 1623.21 852.723 1594.79 854.106 C 1537.27 859.309 1457.26 876.442 1404.18 877.074 L 1359.29 1015.6 C 1352.23 1037.37 1343.24 1069.67 1333.43 1089.63 C 1321.32 1114.25 1286.16 1107.68 1275.7 1080.26 C 1260.09 1039.36 1239.49 998.034 1225.44 956.43 C 1195.92 981.84 1162.32 1016.96 1134.66 1044.91 L 464.249 1712.46 C 414.506 1762.57 362.214 1832.56 283.47 1781.43 C 237.968 1751.88 229.889 1685.4 264.198 1644.16 C 282.594 1622.06 306.991 1601.14 327.421 1580.82 L 984.859 923.047 C 1002.8 904.96 1025.95 883.999 1042.59 865.425 C 1022.95 862.641 971.734 863.446 960.005 848.636 C 939.113 822.258 982.623 795.349 998.774 780.379 L 1075.5 710.521 C 1087.91 699.342 1106.02 683.908 1117.49 672.247 C 1113.33 657.991 1109.53 642.939 1105.31 628.95 L 1074.74 507.113 C 1067.32 476.967 1046.83 446.008 1082.39 434.118 C 1105 440.503 1193.91 487.955 1215.08 501.499 C 1238.96 512.042 1265.14 530 1290 541.556 z M 778.149 1210.57 C 796.348 1228.67 816.224 1247.02 833.831 1265.37 C 839.918 1258.73 841.654 1256.75 849.563 1251.97 C 860.132 1236.95 872.597 1227.04 885.294 1214.13 L 1188.1 911.732 C 1191.35 908.467 1194.75 904.837 1197.66 901.288 C 1195.17 895.07 1192.6 888.251 1189.96 882.151 C 1171.77 880.604 1126.94 875.594 1111.55 877.074 C 1072.39 909.923 1030.89 957.811 993.902 994.664 L 844.909 1143.61 C 822.518 1166.11 799.927 1187.45 778.149 1210.57 z" fill="currentColor"/><path d="M 1082.39 434.118 C 1105 440.503 1193.91 487.955 1215.08 501.499 C 1205.13 502.666 1178.3 479.23 1167.82 479.697 C 1154.17 494.512 1102.73 541.59 1098.24 553.643 C 1096.23 559.035 1090.94 558.448 1090.85 559.56 C 1089.63 573.367 1108.28 618.222 1105.31 628.95 L 1074.74 507.113 C 1067.32 476.967 1046.83 446.008 1082.39 434.118 z" fill="currentColor"/><path d="M 1444.58 517.986 C 1446.47 524.115 1400.47 673.4 1396.33 696.914 C 1433.23 729.915 1494.47 775.479 1534.93 803.609 C 1483.89 814.326 1413.13 820.711 1360.9 826.38 L 1305.11 1003.28 C 1280.99 953.328 1255.56 877.434 1225.44 833.479 C 1225.8 829.704 1205.8 829.486 1202.55 829.139 C 1150.32 823.556 1097.93 817.095 1045.72 811.635 L 1125.81 739.617 C 1141.22 725.864 1163.98 706.761 1177.75 692.588 C 1173.34 670.914 1165.45 644.169 1159.73 622.102 L 1134.66 521.833 C 1156.4 531.754 1181.83 546.733 1202.83 558.48 L 1290 606.113 C 1340.19 577.069 1392.51 543.341 1444.58 517.986 z" fill="currentColor"/><path d="M 737.198 1251.97 C 755.418 1268.94 772.186 1287.99 791.155 1305.81 C 771.862 1327.79 736.434 1360.87 715.067 1382.14 L 444.259 1652.1 C 424.451 1671.94 374.372 1726.03 351.945 1737.26 C 309.372 1751.31 289.035 1702.47 307.082 1682.87 C 336.49 1650.92 367.584 1620.56 398.424 1590.01 L 672.824 1315.66 C 691.666 1296.45 716.8 1268.94 737.198 1251.97 z" fill="currentColor"/><path d="M 1225.44 232.354 C 1236.79 231.284 1249.25 236.229 1253.91 247.297 C 1258.19 257.462 1256.87 358.999 1255.76 375.984 C 1254.74 391.509 1249.83 398.336 1234.38 403.313 C 1209.86 403.429 1202.03 394.869 1202.01 371.214 C 1202 338.958 1201.76 306.674 1201.93 274.414 C 1202.04 253.584 1200.28 237.446 1225.44 232.354 z" fill="currentColor"/><path d="M 1722.46 675.522 C 1738.56 675.43 1793.27 672.246 1799.53 682.548 C 1835.41 741.602 1733.83 729.137 1718.5 729.05 C 1702.77 728.968 1682.28 728.708 1666.9 729.382 C 1622.73 731.316 1622.57 675.378 1665.22 675.446 C 1683.8 675.476 1703.67 675.431 1722.46 675.522 z" fill="currentColor"/><path d="M 1671.3 467.121 C 1692.53 465.06 1700.63 472.148 1705.23 492.203 C 1699.88 515.261 1617.6 594.896 1597.16 602.725 C 1567.89 607.051 1551.88 577.409 1573.7 558.678 C 1595.38 540.073 1649.5 476.255 1671.3 467.121 z" fill="currentColor"/><path d="M 829.281 375.126 C 853.79 371.818 915.297 444.648 934.325 463.483 C 951.178 480.164 944.253 502.818 922.951 510.211 C 897.741 516.129 816.352 423.761 810.963 412.475 C 802.971 395.737 814.056 381.369 829.281 375.126 z" fill="currentColor"/><path d="M 782.737 575.521 C 795.634 575.646 843.215 571.382 851.944 581.992 C 873.19 607.815 852.075 633.726 820.493 629.21 C 814.793 628.395 790.844 629.001 782.737 628.95 C 765.9 629.061 719.052 632.509 711.87 620.64 C 677.696 564.157 766.489 575.415 782.737 575.521 z" fill="currentColor"/><path d="M 1570.75 1234.14 C 1620.93 1231.71 1617.93 1319.69 1581.25 1330.75 C 1535.12 1334.7 1532.03 1247.67 1570.75 1234.14 z" fill="currentColor"/><path d="M 1570.75 1050.49 C 1617.99 1044.93 1619.67 1136.02 1581.25 1146.92 C 1533.63 1150.67 1533.49 1062.04 1570.75 1050.49 z" fill="currentColor"/><path d="M 1469.61 1160.54 C 1566.31 1156.25 1541.23 1212.28 1507.25 1217 C 1489.84 1217.49 1463.81 1221.2 1449.56 1210.82 C 1426.02 1193.69 1444.27 1162.41 1469.61 1160.54 z" fill="currentColor"/><path d="M 1641.73 1160.54 C 1653.06 1160.61 1680.76 1158.77 1689.97 1161.56 C 1720.77 1170.86 1716.48 1203.52 1690.97 1217 C 1681.63 1218.92 1671.01 1216.62 1661.42 1217.24 C 1613.53 1220.35 1604.29 1175.68 1641.73 1160.54 z" fill="currentColor"/></svg></button>
      <button
        class="tool-btn" disabled={!$selection}
        on:click={() => selection.set(null)} title={toolTitle('clearSelection')}
      ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="tool-icon" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg></button>
    </aside>

    <main class="workspace">
      <CanvasView />
      <LayerPanel />
    </main>
  </div>
</div>

{#if showMergeAllConfirm}
<div class="modal-backdrop" on:click|self={() => showMergeAllConfirm = false}>
  <div class="modal">
    <h3>{MODAL.mergeAllTitle}</h3>
    <p class="modal-msg">{MODAL.mergeAllMsg}</p>
    <div class="modal-actions">
      <button class="btn" on:click={() => showMergeAllConfirm = false}>Cancel</button>
      <button class="btn btn-danger" on:click={confirmMergeAll}>Merge All</button>
    </div>
  </div>
</div>
{/if}

{#if showMergeDownConfirm}
<div class="modal-backdrop" on:click|self={() => showMergeDownConfirm = false}>
  <div class="modal">
    <h3>{MODAL.mergeDownTitle}</h3>
    <p class="modal-msg">{MODAL.mergeDownMsg}</p>
    <div class="modal-actions">
      <button class="btn" on:click={() => showMergeDownConfirm = false}>Cancel</button>
      <button class="btn btn-danger" on:click={confirmMergeDown}>Merge</button>
    </div>
  </div>
</div>
{/if}

{#if showContrastDialog}
<div class="modal-backdrop" on:click|self={() => showContrastDialog = false}>
  <div class="modal">
    <h3>{MODAL.contrastTitle}</h3>
    <div class="contrast-row">
      <span class="label">{ADJUST_LABELS.contrast}</span>
      <input type="range" min="-100" max="100" bind:value={contrastValue} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={contrastValue} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showContrastDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmContrast}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showSaturationAdjustDialog}
<div class="modal-backdrop" on:click|self={() => showSaturationAdjustDialog = false}>
  <div class="modal">
    <h3>{MODAL.saturationTitle}</h3>
    <div class="contrast-row">
      <span class="label">{ADJUST_LABELS.saturation}</span>
      <input type="range" min="-100" max="100" bind:value={satAdjustValue} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={satAdjustValue} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showSaturationAdjustDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmSaturationAdjust}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showColorRGBDialog}
<div class="modal-backdrop" on:click|self={() => showColorRGBDialog = false}>
  <div class="modal">
    <h3>{MODAL.colorRGBTitle}</h3>
    <div class="contrast-row">
      <span class="label" style="color:#e07070">R</span>
      <input type="range" min="-100" max="100" bind:value={colorR} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={colorR} />
    </div>
    <div class="contrast-row">
      <span class="label" style="color:#70e070">G</span>
      <input type="range" min="-100" max="100" bind:value={colorG} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={colorG} />
    </div>
    <div class="contrast-row">
      <span class="label" style="color:#7070e0">B</span>
      <input type="range" min="-100" max="100" bind:value={colorB} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={colorB} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showColorRGBDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmColorRGB}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showVibrancyDialog}
<div class="modal-backdrop" on:click|self={() => showVibrancyDialog = false}>
  <div class="modal">
    <h3>{MODAL.vibrancyTitle}</h3>
    <div class="contrast-row">
      <span class="label">{ADJUST_LABELS.vibrancy}</span>
      <input type="range" min="-100" max="100" bind:value={vibrancyValue} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={vibrancyValue} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showVibrancyDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmVibrancy}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showWhiteBalanceDialog}
<div class="modal-backdrop" on:click|self={() => showWhiteBalanceDialog = false}>
  <div class="modal">
    <h3>{MODAL.whiteBalTitle}</h3>
    <div class="contrast-row">
      <span class="label">{ADJUST_LABELS.temperature}</span>
      <input type="range" min="-100" max="100" bind:value={wbTemperature} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={wbTemperature} />
    </div>
    <div class="contrast-row">
      <span class="label">{ADJUST_LABELS.tint}</span>
      <input type="range" min="-100" max="100" bind:value={wbTint} />
      <input class="param-num" type="number" min="-100" max="100" bind:value={wbTint} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showWhiteBalanceDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmWhiteBalance}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showResizeImageDialog}
<div class="modal-backdrop" on:click|self={() => showResizeImageDialog = false}>
  <div class="modal">
    <h3>{MODAL.resizeTitle}</h3>
    <p class="resize-current">Current: {$canvasSize.width} × {$canvasSize.height} px</p>

    <div class="ri-unit-toggle">
      <button class="ri-unit-btn" class:active={riUnit === 'px'} on:click={() => onRiUnit('px')}>px</button>
      <button class="ri-unit-btn" class:active={riUnit === '%'} on:click={() => onRiUnit('%')}>%</button>
    </div>

    <div class="resize-grid">
      <div class="resize-label">Width</div>
      <input class="resize-input" type="number" bind:value={riW} min="1" on:change={onRiWChange} on:input={onRiWChange} />
      <div class="resize-label">Height</div>
      <input class="resize-input" type="number" bind:value={riH} min="1" on:change={onRiHChange} on:input={onRiHChange} />
    </div>

    <label class="ri-constrain">
      <input type="checkbox" bind:checked={riConstrain} />
      Constrain proportions
    </label>

    <p class="resize-result" class:resize-invalid={!riValid}>
      New size: {riNewW} × {riNewH} px
      {#if !riValid}<span class="resize-err"> — invalid</span>{/if}
    </p>

    <div class="modal-actions">
      <button class="btn" on:click={() => showResizeImageDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmResizeImage} disabled={!riValid}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if showCanvasSizeDialog}
<div class="modal-backdrop" on:click|self={() => showCanvasSizeDialog = false}>
  <div class="modal">
    <h3>{MODAL.canvasSizeTitle}</h3>
    <p class="resize-current">Current: {$canvasSize.width} × {$canvasSize.height} px</p>
    <div class="resize-grid">
      <div class="resize-label">Top</div>
      <input class="resize-input" type="number" bind:value={resizeTop} />
      <div class="resize-label">Bottom</div>
      <input class="resize-input" type="number" bind:value={resizeBottom} />
      <div class="resize-label">Left</div>
      <input class="resize-input" type="number" bind:value={resizeLeft} />
      <div class="resize-label">Right</div>
      <input class="resize-input" type="number" bind:value={resizeRight} />
    </div>
    <p class="resize-result" class:resize-invalid={!resizeValid}>
      New size: {resizeNewW} × {resizeNewH} px
      {#if !resizeValid}<span class="resize-err"> — invalid</span>{/if}
    </p>
    <div class="modal-actions">
      <button class="btn" on:click={() => showCanvasSizeDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmResize} disabled={!resizeValid}>Apply</button>
    </div>
  </div>
</div>
{/if}

{#if closeTabPending !== null}
<div class="modal-backdrop" on:click|self={() => closeTabPending = null}>
  <div class="modal">
    <h3>{MODAL.unsavedTitle}</h3>
    <p class="modal-msg">"{$tabs[closeTabPending]?.title}" has unsaved changes. Save before closing?</p>
    <div class="modal-actions">
      <button class="btn" on:click={() => closeTabPending = null}>Cancel</button>
      <button class="btn" on:click={() => discardAndCloseTab(closeTabPending ?? 0)}>Don't Save</button>
      <button class="btn btn-primary" on:click={() => saveAndCloseTab(closeTabPending ?? 0)}>Save</button>
    </div>
  </div>
</div>
{/if}

{#if showTelemetryNotice}
<div class="modal-backdrop">
  <div class="modal telemetry-modal">
    <h3>A note before you start</h3>
    <p class="modal-msg">Imgtrix collects anonymous usage data (which tools you use, session length, and crash reports) to help improve the app. No personal information is ever collected or shared.</p>
    <div class="modal-actions">
      <button class="btn btn-primary" on:click={dismissTelemetryNotice}>Got it</button>
    </div>
  </div>
</div>
{/if}

{#if appClosePending}
<div class="modal-backdrop">
  <div class="modal">
    <h3>{MODAL.unsavedTitle}</h3>
    <p class="modal-msg">
      {$tabs.filter(t => t.isDirty).length === 1
        ? 'You have 1 tab with unsaved changes.'
        : `You have ${$tabs.filter(t => t.isDirty).length} tabs with unsaved changes.`}
    </p>
    <div class="modal-actions">
      <button class="btn" on:click={() => appClosePending = false}>Cancel</button>
      <button class="btn" on:click={discardAndClose}>Don't Save</button>
      <button class="btn btn-primary" on:click={saveAllAndClose}>Save All</button>
    </div>
  </div>
</div>
{/if}

{#if showHotkeysDialog}
<div class="modal-backdrop" on:click|self={() => showHotkeysDialog = false}>
  <div class="modal hotkeys-modal">
    <h3>Hotkeys</h3>
    <p class="modal-msg">Click a field and press the key you want to assign.</p>
    <div class="hotkey-list">
      {#each hotkeyRows as row}
        <div class="hotkey-row">
          <span class="hotkey-label">{row.label}</span>
          <input
            class="hotkey-input"
            type="text"
            readonly
            value={pendingHotkeys[row.key]}
            on:keydown|preventDefault|stopPropagation={e => captureHotkey(row.key, e)}
          />
        </div>
      {/each}
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showHotkeysDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmSaveHotkeys}>Save</button>
    </div>
  </div>
</div>
{/if}

{#if showNewDialog}
<div class="modal-backdrop" on:click|self={() => showNewDialog = false}>
  <div class="modal">
    <h3>{MODAL.newCanvasTitle}</h3>
    <div class="field">
      <label>Width <input type="number" bind:value={newWidth} min="1" max="16384" /></label>
    </div>
    <div class="field">
      <label>Height <input type="number" bind:value={newHeight} min="1" max="16384" /></label>
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => showNewDialog = false}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmNew}>Create</button>
    </div>
  </div>
</div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
  }

  .toolbar {
    height: 64px;
    background: rgba(22, 22, 28, 0.96);
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.03);
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 10px;
    flex-shrink: 0;
  }

  .tab-bar {
    display: flex;
    align-items: stretch;
    background: rgba(14, 14, 18, 0.98);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    height: 32px;
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
  }

  .tab-bar::-webkit-scrollbar { height: 3px; }
  .tab-bar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 12px;
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    color: #666;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    min-width: 80px;
    max-width: 180px;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }

  .tab:hover { background: rgba(255, 255, 255, 0.04); color: #aaa; }

  .tab.active {
    background: rgba(30, 30, 40, 0.98);
    color: #d4d4d4;
    border-top: 2px solid #569cd6;
    box-shadow: inset 0 1px 0 rgba(86, 156, 214, 0.12);
  }

  .tab-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .tab-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0.5;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .tab-close:hover:not(:disabled) { opacity: 1; background: rgba(255, 255, 255, 0.08); }
  .tab-close:disabled { cursor: default; opacity: 0.2; }

  .tab-add {
    background: none;
    border: none;
    color: #555;
    font-size: 18px;
    padding: 0 12px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
  }

  .tab-add:hover { color: #aaa; background: rgba(255, 255, 255, 0.04); }

  .tab-dirty {
    font-size: 8px;
    color: #569cd6;
    line-height: 1;
    flex-shrink: 0;
  }

  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .tool-sidebar {
    width: 48px;
    background: rgba(22, 22, 28, 0.96);
    border-right: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 6px;
    flex-shrink: 0;
  }

  .sidebar-divider {
    width: 28px;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 2px 0;
  }

  .app-name {
    font-weight: 700;
    font-size: 14px;
    color: #569cd6;
    margin-right: 8px;
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 72px;
    flex-shrink: 0;
  }

  .tool-group--color {
    width: auto;
    align-items: center;
  }

  .tool-group--trace {
    width: auto;
  }

  .tool-group input[type="range"] {
    width: 100%;
    margin: 0;
  }

  /* ─── Custom range slider ─────────────────────────────────────────────────── */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
    height: 18px; /* contain the thumb so it doesn't overflow adjacent elements */
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: rgba(160, 200, 240, 0.18);
    border: 1px solid rgba(140, 190, 235, 0.20);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.40),
      inset 0 -1px 0 rgba(255, 255, 255, 0.06);
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    margin-top: -6px;
    background: linear-gradient(
      155deg,
      rgba(200, 230, 255, 0.55) 0%,
      rgba(100, 170, 225, 0.95) 38%,
      rgba(42, 120, 195, 1.0) 100%
    );
    border: 1px solid rgba(20, 70, 140, 0.85);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.50),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
    transition: transform 0.1s, box-shadow 0.1s;
  }

  input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.18);
    box-shadow:
      0 3px 10px rgba(0, 0, 0, 0.65),
      0 0 0 3px rgba(86, 156, 214, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
  }

  input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: rgba(160, 200, 240, 0.18);
    border: 1px solid rgba(140, 190, 235, 0.20);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.40);
  }

  input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: linear-gradient(
      155deg,
      rgba(200, 230, 255, 0.55) 0%,
      rgba(100, 170, 225, 0.95) 38%,
      rgba(42, 120, 195, 1.0) 100%
    );
    border: 1px solid rgba(20, 70, 140, 0.85);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.50),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
  }

  .label {
    font-size: 11px;
    color: #b0b0b0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  input[type="color"] {
    width: 28px;
    height: 28px;
    padding: 2px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
  }

  .tool-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    color: #c8c8c8;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }
  .tool-btn:hover { background: rgba(255, 255, 255, 0.11); border-color: rgba(255, 255, 255, 0.16); }
  .tool-btn.active {
    background: rgba(86, 156, 214, 0.20);
    border-color: rgba(86, 156, 214, 0.60);
    box-shadow: 0 0 0 1px rgba(86, 156, 214, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: #d4d4d4;
  }
  .tool-btn:disabled { opacity: 0.30; cursor: default; }
  .tool-btn:disabled:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.10); box-shadow: none; }
  .tool-btn-lg { font-size: 26px; }

  .tool-icon {
    width: 26px;
    height: 26px;
    display: block;
  }


  .divider {
    width: 1px;
    height: 44px;
    background: rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .param-num {
    width: 100%;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 5px;
    color: #d4d4d4;
    font-size: 11px;
    padding: 2px 4px;
    text-align: right;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .param-num:focus {
    outline: none;
    border-color: rgba(86, 156, 214, 0.7);
    box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.15);
  }
  /* Hide spinner arrows on regular param inputs */
  .param-num:not(.param-num--wide)::-webkit-outer-spin-button,
  .param-num:not(.param-num--wide)::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  /* Wide variant for position inputs — keeps spinner arrows, fits negative coords */
  .param-num--wide {
    width: 70px;
  }

  .tool-group--mode {
    width: 90px;
  }

  .mode-select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 5px;
    color: #d4d4d4;
    font-size: 11px;
    padding: 2px 4px;
    width: 100%;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .mode-select:focus {
    outline: none;
    border-color: rgba(86, 156, 214, 0.7);
    box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.15);
  }

  .trace-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #aaa;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .sel-hint {
    font-size: 11px;
    color: #555;
    font-style: italic;
  }

  .sel-info {
    font-size: 12px;
    color: #ccc;
    white-space: nowrap;
  }

  .sel-info--muted {
    color: #666;
  }

  .ed-color-readout {
    font-size: 12px;
    font-family: monospace;
    color: #bbb;
    white-space: nowrap;
    align-self: center;
  }

  .sel-clear {
    font-size: 11px;
    padding: 2px 8px;
  }

  .clone-hint {
    font-size: 10px;
    color: #555;
    font-style: italic;
  }

  .spacer { flex: 1; }

  .zoom-display {
    font-size: 12px;
    color: #888;
    min-width: 40px;
    text-align: right;
  }

  .btn {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.11);
    color: #d4d4d4;
    padding: 4px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn:hover { background: rgba(255, 255, 255, 0.13); border-color: rgba(255, 255, 255, 0.18); }

  .canvas-size {
    font-size: 11px;
    color: #666;
    min-width: 72px;
    text-align: right;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: rgba(20, 20, 28, 0.90);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 24px 64px rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(32px) saturate(160%);
    border-radius: 16px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 240px;
  }

  .modal h3 {
    margin: 0;
    font-size: 14px;
    color: #d4d4d4;
  }

  .modal-msg {
    margin: 0;
    font-size: 12px;
    color: #aaa;
    line-height: 1.5;
  }

  .field label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: #aaa;
  }

  .field input[type="number"] {
    width: 80px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 6px;
    color: #d4d4d4;
    padding: 4px 6px;
    font-size: 12px;
    text-align: right;
  }

  .resize-current {
    margin: 0;
    font-size: 12px;
    color: #777;
  }

  .ri-unit-toggle {
    display: flex;
    gap: 4px;
  }

  .ri-unit-btn {
    padding: 3px 12px;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 6px;
    color: #aaa;
    cursor: pointer;
    transition: background 0.15s;
  }

  .ri-unit-btn.active {
    background: rgba(86, 156, 214, 0.22);
    border-color: rgba(86, 156, 214, 0.55);
    color: #d4d4d4;
  }

  .ri-constrain {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #aaa;
    cursor: pointer;
  }

  .resize-grid {
    display: grid;
    grid-template-columns: 60px 80px 60px 80px;
    align-items: center;
    gap: 6px 10px;
  }

  .resize-label {
    font-size: 12px;
    color: #aaa;
    text-align: right;
  }

  .resize-input {
    width: 80px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 6px;
    color: #d4d4d4;
    padding: 4px 6px;
    font-size: 12px;
    text-align: right;
  }

  .resize-result {
    margin: 0;
    font-size: 12px;
    color: #ccc;
  }

  .resize-invalid {
    color: #c44;
  }

  .resize-err {
    color: #c44;
  }

  .contrast-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
  }
  .contrast-row .label {
    font-size: 12px;
    color: #aaa;
    white-space: nowrap;
  }
  .contrast-row input[type="range"] {
    flex: 1;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .telemetry-modal {
    max-width: 340px;
  }

  .hotkeys-modal {
    min-width: 360px;
  }

  .hotkey-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 380px;
    overflow-y: auto;
  }

  .hotkey-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
  }

  .hotkey-label {
    font-size: 12px;
    color: #aaa;
    flex: 1;
  }

  .hotkey-input {
    width: 60px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 6px;
    color: #d4d4d4;
    padding: 4px 6px;
    font-size: 12px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .hotkey-input:focus {
    border-color: rgba(86, 156, 214, 0.7);
    box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.15);
    outline: none;
    background: rgba(86, 156, 214, 0.06);
  }

  .btn-primary {
    background: rgba(86, 156, 214, 0.22);
    border-color: rgba(86, 156, 214, 0.55);
    color: #d4d4d4;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .btn-primary:hover {
    background: rgba(86, 156, 214, 0.32);
    border-color: rgba(86, 156, 214, 0.70);
  }

  .btn-danger {
    background: rgba(180, 50, 50, 0.22);
    border-color: rgba(196, 68, 68, 0.55);
    color: #d4d4d4;
  }
  .btn-danger:hover { background: rgba(180, 50, 50, 0.35); border-color: rgba(196, 68, 68, 0.70); }

  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-width: 0;
  }
</style>
