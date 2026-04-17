import { app, ipcMain } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/constants/settings_defaults'

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

function mergeWithDefaults(partial: Partial<AppSettings>): AppSettings {
  return {
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...partial.hotkeys },
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    return mergeWithDefaults(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:load', async () => {
    return loadSettings()
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    await saveSettings(settings)
  })

  ipcMain.handle('settings:reset', async () => {
    await saveSettings(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  })
}
