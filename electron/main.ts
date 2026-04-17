import * as Sentry from '@sentry/electron/main'

Sentry.init({
  dsn: 'https://9ddbf4c6795bb9aad963ce159556cd2f@o4511221561229312.ingest.us.sentry.io/4511221563457536',
})

import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { readFile, writeFile } from 'fs/promises'
import { MENU } from './menu-strings'
import { MENU_KEYS } from '../src/constants/hotkeys'
import { registerSettingsIpc } from './settings-manager'

let mainWindow: BrowserWindow | null = null
let windowCloseAllowed = false
let hasSelection = false
let hasClipboard = false

// File path passed via "Open with" context menu (process.argv)
const IMAGE_EXTS = /\.(png|jpe?g|webp|bmp|gif|img)$/i
const openWithFile: string | null = process.argv.slice(is.dev ? 2 : 1).find(a => !a.startsWith('-') && IMAGE_EXTS.test(a)) ?? null

function buildMenu(): void {
  const send = (action: string) => mainWindow?.webContents.send('menu:action', action)

  const menu = Menu.buildFromTemplate([
    {
      label: MENU.file,
      submenu: [
        { label: MENU.new,         accelerator: MENU_KEYS.new,       click: () => send('new') },
        { type: 'separator' },
        { label: MENU.open,        accelerator: MENU_KEYS.open,      click: () => send('open') },
        { label: MENU.importLayer, accelerator: MENU_KEYS.import,    click: () => send('import') },
        { label: MENU.importAsNew, accelerator: MENU_KEYS.importNew, click: () => send('import-new') },
        { type: 'separator' },
        { label: MENU.save,        accelerator: MENU_KEYS.save,      click: () => send('save') },
        { label: MENU.saveAs,      accelerator: MENU_KEYS.saveAs,    click: () => send('save-as') },
        { type: 'separator' },
        { label: MENU.export,      accelerator: MENU_KEYS.export,    click: () => send('export') },
        { type: 'separator' },
        { label: MENU.exit, role: 'quit' }
      ]
    },
    {
      label: MENU.edit,
      submenu: [
        { label: MENU.undo,           accelerator: MENU_KEYS.undo,           click: () => send('undo') },
        { label: MENU.redo,           accelerator: MENU_KEYS.redo,           click: () => send('redo') },
        { type: 'separator' },
        { label: MENU.cut,            accelerator: MENU_KEYS.cut,            enabled: hasSelection, click: () => send('cut') },
        { label: MENU.copy,           accelerator: MENU_KEYS.copy,           enabled: hasSelection, click: () => send('copy') },
        { label: MENU.paste,          accelerator: MENU_KEYS.paste,          enabled: hasClipboard, click: () => send('paste') },
        { label: MENU.selectAll,      accelerator: MENU_KEYS.selectAll,      click: () => send('select-all') },
        { label: MENU.clearSelection, accelerator: MENU_KEYS.clearSelection, enabled: hasSelection, click: () => send('clear-selection') }
      ]
    },
    {
      label: MENU.image,
      submenu: [
        { label: MENU.resizeImage,  click: () => send('resize-image') },
        { label: MENU.canvasSize,   click: () => send('canvas-size') },
        { type: 'separator' },
        { label: MENU.selectionToNew, enabled: hasSelection, click: () => send('selection-to-new-image') },
        { type: 'separator' },
        { label: MENU.rotate90CW,  click: () => send('rotate-90-cw') },
        { label: MENU.rotate90CCW, click: () => send('rotate-90-ccw') },
        { label: MENU.rotate180,   click: () => send('rotate-180') }
      ]
    },
    {
      label: MENU.adjust,
      submenu: [
        { label: MENU.contrast,     click: () => send('contrast') },
        { label: MENU.saturation,   click: () => send('adjust-saturation') },
        { label: MENU.vibrancy,     click: () => send('adjust-vibrancy') },
        { label: MENU.whiteBalance, click: () => send('adjust-white-balance') },
        { label: MENU.colorRGB,     click: () => send('adjust-color-rgb') }
      ]
    },
    {
      label: MENU.layers,
      submenu: [
        { label: MENU.newLayer,       accelerator: MENU_KEYS.newLayer,       click: () => send('new-layer') },
        { label: MENU.duplicateLayer, accelerator: MENU_KEYS.duplicateLayer, click: () => send('duplicate-layer') },
        { label: MENU.deleteLayer,                                            click: () => send('delete-layer') },
        { type: 'separator' },
        { label: MENU.mergeDown, click: () => send('merge-down') },
        { label: MENU.mergeAll,  click: () => send('merge-all') },
        { type: 'separator' },
        { label: MENU.moveLayerUp,   click: () => send('layer-move-up') },
        { label: MENU.moveLayerDown, click: () => send('layer-move-down') }
      ]
    },
    {
      label: MENU.view,
      submenu: [
        { label: MENU.fitToView, accelerator: MENU_KEYS.fitView, click: () => send('fit-view') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(is.dev ? [
          { type: 'separator' as const },
          { role: 'reload' as const },
          { role: 'toggleDevTools' as const }
        ] : [])
      ]
    },
    {
      label: MENU.window,
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    },
    {
      label: MENU.settings,
      submenu: [
        { label: MENU.hotkeys,         click: () => send('settings-hotkeys') },
        { type: 'separator' },
        { label: MENU.restoreDefaults, click: () => send('settings-restore-defaults') }
      ]
    }
  ])

  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())
  mainWindow.on('closed', () => { mainWindow = null; windowCloseAllowed = false })
  mainWindow.on('close', (e) => {
    if (!windowCloseAllowed) {
      e.preventDefault()
      mainWindow?.webContents.send('window:before-close')
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of Imgtrix has been downloaded.',
      detail: 'Restart the app to apply the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', () => { /* fail silently */ })

  // Delay the first check so it doesn't race with window startup
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000)
}

app.whenReady().then(() => {
  registerSettingsIpc()
  createWindow()
  buildMenu()
  if (!is.dev) setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('selection:changed', (_e, val: boolean) => {
  hasSelection = val
  buildMenu()
})

ipcMain.on('clipboard:changed', (_e, val: boolean) => {
  hasClipboard = val
  buildMenu()
})

ipcMain.handle('file:open-dialog', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Image Editor Project', extensions: ['img'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('file:import-dialog', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('file:save-dialog', async (_e, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Image Editor Project', extensions: ['img'] }]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('file:export-dialog', async (_e, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg'] },
      { name: 'WebP Image', extensions: ['webp'] }
    ]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('file:read', async (_e, path: string): Promise<ArrayBuffer> => {
  const buffer = await readFile(path)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
})

ipcMain.handle('file:write', async (_e, path: string, data: ArrayBuffer): Promise<void> => {
  await writeFile(path, Buffer.from(data))
})

ipcMain.on('window:allow-close', () => {
  windowCloseAllowed = true
  mainWindow?.close()
})

ipcMain.handle('app:open-with-file', () => openWithFile)
