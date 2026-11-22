import App from '../src/App.svelte'
import { tick } from 'svelte'
import { get } from 'svelte/store'
import { DEFAULT_SETTINGS } from '../src/constants/settings_defaults'
import {
  layerStack, historyManager, tabs, activeTabIndex, newTab, markCurrentTabClean,
  adjustmentOpen, selection, menuAction, bump,
} from '../src/store'

const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message) }
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
let menu: (action: string) => void
let beforeClose: () => void
let writes = 0
Object.assign(window, { api: {
  loadSettings: async () => structuredClone(DEFAULT_SETTINGS),
  getOpenWithFile: async () => null,
  onMenuAction: (callback: typeof menu) => { menu = callback },
  onBeforeClose: (callback: typeof beforeClose) => { beforeClose = callback },
  onOpenFile: () => {}, notifySelectionChanged: () => {}, notifyClipboardChanged: () => {},
  writeFile: () => { writes++ }, allowClose: () => {},
} })
localStorage.setItem('imgtrix_telemetry_ack', '1')
new App({ target: document.getElementById('app')! })

const settle = async (): Promise<void> => {
  await tick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}
const dialog = (): HTMLElement => document.querySelector('.adjustment-backdrop')!
const button = (text: string): HTMLButtonElement => [...dialog().querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const input = (type: string, index = 0): HTMLInputElement => dialog().querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)[index]
const setValue = async (value: string, type = 'range', index = 0): Promise<void> => {
  const field = input(type, index)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
const pixels = (): number[][] => get(layerStack).layers.map(l => Array.from(l.getImageData().data))
const dirty = (): boolean => get(tabs)[get(activeTabIndex)].isDirty

async function run(): Promise<string> {
  await settle()
  newTab(3, 2)
  const stack = get(layerStack)
  const base = stack.active
  base.putImageData(new ImageData(new Uint8ClampedArray([
    80, 120, 160, 255, 30, 60, 90, 255, 200, 100, 50, 255,
    10, 200, 80, 255, 120, 80, 40, 128, 0, 0, 0, 0,
  ]), 3, 2))
  const other = stack.add('Hidden offset layer', 2, 1)
  other.putImageData(new ImageData(new Uint8ClampedArray([80, 120, 160, 255, 10, 30, 50, 255]), 2, 1))
  other.visible = false
  other.offsetX = -1
  other.offsetY = 2
  other.opacity = 0.4
  other.blendMode = 'screen'
  const original = pixels()
  const originalCanvases = stack.layers.map(l => l.canvas)
  base.modified = false
  markCurrentTabClean()
  await settle()
  const hm = get(historyManager)

  for (const action of ['contrast', 'adjust-saturation', 'adjust-vibrancy', 'adjust-white-balance', 'adjust-color-rgb']) {
    menu(action)
    await settle()
    assert(get(adjustmentOpen) && dialog(), action + ': did not open')
    assert(getComputedStyle(dialog()).backdropFilter === 'none', 'Preview must not blur canvas')
    assert(document.querySelector('.app')!.hasAttribute('inert'), 'Background must not accept edits')
    await setValue('40')
    const firstPreview = pixels()
    assert(!equal(firstPreview, original), action + ': slider did not preview')
    assert(hm.stepCount === 0 && !dirty() && !base.modified, 'Preview changed history/dirty state')
    await setValue('-40')
    await setValue('40', 'number')
    assert(equal(pixels(), firstPreview), action + ': previews accumulated')
    input('checkbox').click()
    await settle()
    assert(equal(pixels(), original), 'Preview off did not restore original')
    input('checkbox').click()
    await settle()
    assert(equal(pixels(), firstPreview), 'Preview on did not restore adjustment')
    await setValue('0')
    assert(equal(pixels(), original), 'Zero did not restore original')
    dialog().querySelector<HTMLButtonElement>('.step--up')!.click()
    await settle()
    assert(input('number').value === '1', 'Stepper did not update value')
    await setValue('', 'number')
    assert(button('Apply').disabled, 'Empty value should disable Apply')
    await setValue('101', 'number')
    assert(button('Apply').disabled, 'Out of range value should disable Apply')
    await setValue('40', 'number')
    menu('save')
    menu('new-layer')
    assert(writes === 0 && stack.layers.length === 2, 'Menu changed document during preview')
    button('Cancel').click()
    await settle()
    assert(equal(pixels(), original) && !dirty() && hm.stepCount === 0, 'Cancel did not restore state')
    assert(!document.querySelector<HTMLElement>('.app')!.inert, 'Background stayed disabled after Cancel')
    assert(stack.layers.every((l, i) => l.canvas === originalCanvases[i]), 'Cancel did not restore canvas identity')
  }

  menu('adjust-white-balance')
  await settle()
  await setValue('50')
  await setValue('-25', 'number', 1)
  assert(equal(pixels()[0].slice(0, 4), [95, 130, 135, 255]), 'White balance combined controls')
  button('Cancel').click()
  await settle()

  menu('adjust-color-rgb')
  await settle()
  await setValue('20')
  await setValue('10', 'range', 1)
  await setValue('-10', 'range', 2)
  const expected = pixels()
  input('checkbox').click()
  await settle()
  button('Apply').click()
  await settle()
  assert(equal(pixels(), expected) && hm.stepCount === 1 && dirty(), 'Apply with Preview off')
  assert(base.modified && other.modified, 'Commit must mark layers modified')
  menu('undo')
  await settle()
  assert(equal(pixels(), original), 'Undo did not restore all layers')
  menu('redo')
  await settle()
  assert(equal(pixels(), expected), 'Redo did not restore all layers')
  assert(other.offsetX === -1 && other.offsetY === 2 && other.opacity === 0.4 && !other.visible && other.blendMode === 'screen', 'Layer metadata changed')

  markCurrentTabClean()
  menu('contrast')
  await settle()
  button('Apply').click()
  await settle()
  assert(hm.stepCount === 1 && !dirty(), 'Neutral Apply should be a no-op')

  // Commit immediately after input, before the pending animation frame.
  menu('adjust-color-rgb')
  await settle()
  input('range').value = '10'
  input('range').dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  button('Apply').click()
  await settle()
  assert(hm.stepCount === 2 && !equal(pixels(), expected), 'Apply dropped the latest pending value')
  menu('undo')
  await settle()
  assert(equal(pixels(), expected), 'Pending preview history incorrect')

  selection.set({ type: 'rect', x: 0, y: 0, w: 1, h: 1 })
  for (const dismiss of ['escape', 'backdrop', 'close']) {
    menu('contrast')
    await settle()
    await setValue('80')
    const steps = hm.stepCount
    const wasDirty = dirty()
    const couldRedo = hm.canRedo
    input('range').focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))
    assert(hm.stepCount === steps, 'Undo shortcut modified document during preview')
    input('range').value = '25'
    input('range').dispatchEvent(new Event('input', { bubbles: true }))
    await tick() // Dismiss while a new preview frame is still pending.
    if (dismiss === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    if (dismiss === 'backdrop') dialog().click()
    if (dismiss === 'close') beforeClose()
    await settle()
    assert(equal(pixels(), expected) && !get(adjustmentOpen), dismiss + ': preview survived dismissal')
    assert(dirty() === wasDirty && hm.canRedo === couldRedo, 'Dismissal changed dirty/redo state')
    assert(get(selection) !== null, 'Escape cleared selection behind dialog')
    if (dismiss === 'close') {
      const cancelClose = [...document.querySelectorAll<HTMLButtonElement>('.modal-actions button')].find(b => b.textContent === 'Cancel')
      cancelClose?.click()
      await settle()
    }
  }

  // Exercise full-size updates and leave a preview visible for layout inspection.
  newTab(1920, 1080)
  const sample = get(layerStack).active
  const gradient = sample.ctx.createLinearGradient(0, 0, 1920, 1080)
  gradient.addColorStop(0, '#306090')
  gradient.addColorStop(0.5, '#af8b68')
  gradient.addColorStop(1, '#508060')
  sample.ctx.fillStyle = gradient
  sample.ctx.fillRect(0, 0, 1920, 1080)
  sample.markDirty()
  markCurrentTabClean()
  const timings: string[] = []
  for (const action of ['contrast', 'adjust-saturation', 'adjust-vibrancy', 'adjust-white-balance', 'adjust-color-rgb']) {
    menu(action)
    await settle()
    const start = performance.now()
    await setValue('30')
    timings.push(`${action}: ${Math.round(performance.now() - start)}ms`)
    button('Cancel').click()
    await settle()
  }
  menu('adjust-color-rgb')
  await settle()
  await setValue('20')
  bump()
  menuAction.set('render')
  await settle()
  return 'PASS: all 5 dialogs, sliders, numeric fields, steppers, baseline previews, comparison toggle, neutral settings, validation, Cancel/Escape/backdrop/close, dirty flags, one-step undo/redo, pending frames, hidden layers/offsets, menu and shortcut isolation\n1080p input-to-preview (including two frames, software rendering): ' + timings.join(', ')
}

Object.assign(window, { adjustmentTests: run() })
