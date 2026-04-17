import { TOOL_KEYS } from './hotkeys'

export const TOOL_NAMES = {
  paintbrush:     'Paintbrush',
  eraser:         'Eraser',
  clone:          'Clone Stamp',
  warp:           'Warp Brush',
  blend:          'Blend / Smudge',
  saturation:     'Saturation',
  dodgeBurn:      'Lighten / Darken',
  move:           'Move Selection',
  moveLayer:      'Move Layer',
  rectSelect:     'Rectangular Select',
  lasso:          'Freehand Select',
  magicWand:      'Magic Wand',
  eyedropper:     'Eyedropper',
  fill:           'Fill',
  clearSelection: 'Clear Selection',
} as const

export type ToolName = keyof typeof TOOL_NAMES

/** Builds the tooltip string shown on sidebar buttons, e.g. "Paintbrush (B)" */
export function toolTitle(tool: ToolName): string {
  const name = TOOL_NAMES[tool]
  const key  = TOOL_KEYS[tool]
  return `${name} (${key})`
}
