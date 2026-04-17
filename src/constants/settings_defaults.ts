import { TOOL_KEYS } from './hotkeys'

export interface HotkeySettings {
  paintbrush:     string
  eraser:         string
  clone:          string
  warp:           string
  blend:          string
  saturation:     string
  dodgeBurn:      string
  move:           string
  moveLayer:      string
  rectSelect:     string
  lasso:          string
  magicWand:      string
  eyedropper:     string
  fill:           string
  clearSelection: string
}

export interface AppSettings {
  hotkeys: HotkeySettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  hotkeys: {
    paintbrush:     TOOL_KEYS.paintbrush,
    eraser:         TOOL_KEYS.eraser,
    clone:          TOOL_KEYS.clone,
    warp:           TOOL_KEYS.warp,
    blend:          TOOL_KEYS.blend,
    saturation:     TOOL_KEYS.saturation,
    dodgeBurn:      TOOL_KEYS.dodgeBurn,
    move:           TOOL_KEYS.move,
    moveLayer:      TOOL_KEYS.moveLayer,
    rectSelect:     TOOL_KEYS.rectSelect,
    lasso:          TOOL_KEYS.lasso,
    magicWand:      TOOL_KEYS.magicWand,
    eyedropper:     TOOL_KEYS.eyedropper,
    fill:           TOOL_KEYS.fill,
    clearSelection: TOOL_KEYS.clearSelection,
  }
}
