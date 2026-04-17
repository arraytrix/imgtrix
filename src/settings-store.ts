import { writable, get } from 'svelte/store'
import { DEFAULT_SETTINGS, type AppSettings, type HotkeySettings } from './constants/settings_defaults'

export const settings = writable<AppSettings>(DEFAULT_SETTINGS)

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
