import { writable, get } from 'svelte/store'
import { DEFAULT_SETTINGS, type AppSettings, type HotkeySettings } from './constants/settings_defaults'
import { setHistoryBudgetMB } from './engine/history-manager'
import { tabs } from './store'

export const settings = writable<AppSettings>(DEFAULT_SETTINGS)

// Keep the engine in step with the setting no matter what changed it — load,
// save, or restore-defaults. Lowering the budget trims open tabs right away
// instead of waiting for their next edit.
settings.subscribe(s => {
  setHistoryBudgetMB(s.historyBudgetMB)
  for (const tab of get(tabs)) tab.historyManager.trim()
})

export function updateHistoryBudget(mb: number): void {
  settings.update(s => ({ ...s, historyBudgetMB: mb }))
}

export async function loadSettings(): Promise<void> {
  const loaded = await window.api.loadSettings() as AppSettings
  settings.set(loaded)
}

export async function saveSettings(): Promise<void> {
  await window.api.saveSettings(get(settings))
}

export async function resetHotkeys(): Promise<void> {
  const reset = await window.api.resetSettings() as AppSettings
  settings.set(reset)
}

export function updateHotkeys(hotkeys: Partial<HotkeySettings>): void {
  settings.update(s => ({ ...s, hotkeys: { ...s.hotkeys, ...hotkeys } }))
}
