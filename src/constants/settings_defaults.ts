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
  cropToSelection: string
}

export interface AppSettings {
  hotkeys: HotkeySettings
  /** Memory each tab's undo history may hold, in MB. */
  historyBudgetMB: number
}

// Undo snapshots are raw RGBA, so this is real resident memory — and it is per
// tab, not for the app as a whole. The ceiling is deliberately generous;
// machines with a lot of RAM can keep a much deeper history than the default.
export const HISTORY_BUDGET_MIN_MB = 64
export const HISTORY_BUDGET_MAX_MB = 65536
export const HISTORY_BUDGET_DEFAULT_MB = 512

/** Coerce anything read off disk into a usable budget. */
export function clampHistoryBudgetMB(value: unknown): number {
  const mb = Math.round(Number(value))
  if (!Number.isFinite(mb)) return HISTORY_BUDGET_DEFAULT_MB
  return Math.max(HISTORY_BUDGET_MIN_MB, Math.min(HISTORY_BUDGET_MAX_MB, mb))
}

export const DEFAULT_SETTINGS: AppSettings = {
  historyBudgetMB: HISTORY_BUDGET_DEFAULT_MB,
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
    cropToSelection: TOOL_KEYS.cropToSelection,
  }
}
