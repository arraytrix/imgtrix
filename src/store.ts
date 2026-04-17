import { writable, get } from 'svelte/store'
import { LayerStack } from './engine/layer-stack'
import { HistoryManager } from './engine/history-manager'
import { WebGLCompositor } from './engine/webgl-compositor'
import { ToolManager } from './engine/tool-manager'

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

// Singletons that don't change between tabs
export const compositor = new WebGLCompositor()
export const toolManager = new ToolManager(DEFAULT_WIDTH, DEFAULT_HEIGHT)

export type { Selection } from './engine/selection'
import type { Selection } from './engine/selection'

export interface Tab {
  id: string
  title: string
  filePath: string | null
  layerStack: LayerStack
  historyManager: HistoryManager
  selection: Selection | null
  savedViewport: { offsetX: number; offsetY: number; zoom: number }
  savedZoomPct: number
  needsFitView: boolean
  isDirty: boolean
}

function wireDirtyCallback(tab: Tab): void {
  tab.historyManager.onChanged = () => {
    tabs.update(ts => {
      tab.isDirty = true
      return [...ts]
    })
  }
}

function makeTab(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): Tab {
  const tab: Tab = {
    id: crypto.randomUUID(),
    title: 'Untitled',
    filePath: null,
    layerStack: new LayerStack(width, height),
    historyManager: new HistoryManager(),
    selection: null,
    savedViewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    savedZoomPct: 100,
    needsFitView: true,
    isDirty: false,
  }
  wireDirtyCallback(tab)
  return tab
}

const _firstTab = makeTab()

// Active-tab-backed stores — swapped on tab switch
export const layerStack = writable<LayerStack>(_firstTab.layerStack)
export const historyManager = writable<HistoryManager>(_firstTab.historyManager)
export const canvasSize = writable({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
export const selection = writable<Selection | null>(null)

// Tab list
export const tabs = writable<Tab[]>([_firstTab])
export const activeTabIndex = writable(0)

// Viewport — plain object for performance (mutated directly on every mouse move)
export interface Viewport {
  offsetX: number
  offsetY: number
  zoom: number
}
export const viewport: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 }

// Reactive zoom percentage for the toolbar display
export const zoomPct = writable(100)

// Active tool name — drives toolbar highlight
export const activeToolName = writable<'paintbrush' | 'eraser' | 'clone' | 'warp' | 'blend' | 'saturation' | 'dodge-burn' | 'eyedropper' | 'rect-select' | 'lasso-select' | 'magic-wand' | 'move' | 'move-layer'>('paintbrush')

// Menu-triggered actions that need handler context inside CanvasView
export const menuAction = writable<string | null>(null)

// Internal pixel clipboard — shared across tabs
export interface ClipboardEntry {
  imageData: ImageData
  x: number
  y: number
}
export const clipboard = writable<ClipboardEntry | null>(null)

// Increment to force Svelte reactivity after imperative mutations to layerStack
export const layerTick = writable(0)
export const bump = (): void => layerTick.update(n => n + 1)

// ---- Tab management -------------------------------------------------------

function saveCurrentTabState(): void {
  const $tabs = get(tabs)
  const idx = get(activeTabIndex)
  const tab = $tabs[idx]
  if (!tab) return
  tab.selection = get(selection)
  tab.savedViewport = { ...viewport }
  tab.savedZoomPct = get(zoomPct)
}

function loadTabState(tab: Tab): void {
  layerStack.set(tab.layerStack)
  historyManager.set(tab.historyManager)
  selection.set(tab.selection)
  canvasSize.set({ width: tab.layerStack.width, height: tab.layerStack.height })
  viewport.offsetX = tab.savedViewport.offsetX
  viewport.offsetY = tab.savedViewport.offsetY
  viewport.zoom = tab.savedViewport.zoom
  zoomPct.set(tab.savedZoomPct)
  toolManager.resize(tab.layerStack.width, tab.layerStack.height)
}

export function switchTab(idx: number): void {
  const $tabs = get(tabs)
  if (idx < 0 || idx >= $tabs.length) return
  if (idx === get(activeTabIndex)) return
  saveCurrentTabState()
  activeTabIndex.set(idx)
  const tab = $tabs[idx]
  loadTabState(tab)
  if (tab.needsFitView) {
    tab.needsFitView = false
    menuAction.set('fit-view')
  } else {
    menuAction.set('render')
  }
  bump()
}

export function newTab(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): void {
  const tab = makeTab(width, height)
  saveCurrentTabState()
  tabs.update($tabs => [...$tabs, tab])
  activeTabIndex.set(get(tabs).length - 1)
  loadTabState(tab)
  menuAction.set('fit-view')
  tab.needsFitView = false
  bump()
}

export function openInNewTab(ls: LayerStack, hm: HistoryManager, title: string, filePath: string | null): void {
  const tab = makeTab()
  tab.layerStack = ls
  tab.historyManager = hm
  tab.title = title
  tab.filePath = filePath
  wireDirtyCallback(tab)  // re-wire since we replaced historyManager
  saveCurrentTabState()
  tabs.update($tabs => [...$tabs, tab])
  activeTabIndex.set(get(tabs).length - 1)
  loadTabState(tab)
  menuAction.set('fit-view')
  tab.needsFitView = false
  bump()
}

export function closeTab(idx: number): void {
  const $tabs = get(tabs)
  if ($tabs.length <= 1) return
  const currentIdx = get(activeTabIndex)
  let newIdx = currentIdx
  if (idx < currentIdx) newIdx = currentIdx - 1
  else if (idx === currentIdx) newIdx = Math.min(currentIdx, $tabs.length - 2)
  tabs.update(ts => ts.filter((_, i) => i !== idx))
  activeTabIndex.set(newIdx)
  loadTabState(get(tabs)[newIdx])
  menuAction.set('render')
  bump()
}

export function updateTabMeta(idx: number, title: string, filePath: string | null): void {
  tabs.update(ts => {
    ts[idx].title = title
    ts[idx].filePath = filePath
    return [...ts]
  })
}

export function markCurrentTabDirty(): void {
  const idx = get(activeTabIndex)
  tabs.update(ts => {
    ts[idx].isDirty = true
    return [...ts]
  })
}

export function markCurrentTabClean(): void {
  const idx = get(activeTabIndex)
  tabs.update(ts => {
    ts[idx].isDirty = false
    return [...ts]
  })
}
