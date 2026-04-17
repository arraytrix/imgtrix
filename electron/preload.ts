import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('file:open-dialog'),
  importDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('file:import-dialog'),
  saveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:save-dialog', defaultName),
  exportDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:export-dialog', defaultName),
  readFile: (path: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, data: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('file:write', path, data),
  onMenuAction: (callback: (action: string) => void): void => {
    ipcRenderer.removeAllListeners('menu:action')
    ipcRenderer.on('menu:action', (_e, action) => callback(action))
  },
  onBeforeClose: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('window:before-close')
    ipcRenderer.on('window:before-close', callback)
  },
  allowClose: (): void => {
    ipcRenderer.send('window:allow-close')
  },
  notifySelectionChanged: (hasSelection: boolean): void => {
    ipcRenderer.send('selection:changed', hasSelection)
  },
  notifyClipboardChanged: (hasClipboard: boolean): void => {
    ipcRenderer.send('clipboard:changed', hasClipboard)
  },
  getOpenWithFile: (): Promise<string | null> =>
    ipcRenderer.invoke('app:open-with-file'),
  loadSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:save', settings),
  resetSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:reset'),
})

// Type declaration for renderer-side usage
declare global {
  interface Window {
    api: {
      openDialog(): Promise<string | null>
      importDialog(): Promise<string | null>
      saveDialog(defaultName: string): Promise<string | null>
      exportDialog(defaultName: string): Promise<string | null>
      readFile(path: string): Promise<ArrayBuffer>
      writeFile(path: string, data: ArrayBuffer): Promise<void>
      onMenuAction(callback: (action: string) => void): void
      onBeforeClose(callback: () => void): void
      allowClose(): void
      notifySelectionChanged(hasSelection: boolean): void
      notifyClipboardChanged(hasClipboard: boolean): void
      getOpenWithFile(): Promise<string | null>
      loadSettings(): Promise<unknown>
      saveSettings(settings: unknown): Promise<void>
      resetSettings(): Promise<unknown>
    }
  }
}
