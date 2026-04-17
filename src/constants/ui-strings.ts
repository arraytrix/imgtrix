// ---- Toolbar hints ----------------------------------------------------------

export const HINTS = {
  moveSelection:      'Drag to move selection',
  makeSelectionFirst: 'Make a selection first',
  moveLayer:          'Drag to move active layer',
  lassoSelect:        'Draw to select',
  rectSelect:         'Click and drag to select',
} as const

// ---- Mode select options ----------------------------------------------------

export const SAT_MODE_LABELS = {
  up:   'Saturate',
  down: 'Desaturate',
} as const

export const DODGE_MODE_LABELS = {
  dodge: 'Lighten',
  burn:  'Darken',
} as const

export const WARP_MODE_LABELS = {
  push:        'Push',
  twirl:       'Twirl',
  bloat:       'Bloat',
  pucker:      'Pucker',
  reconstruct: 'Reconstruct',
} as const

// ---- Modal titles & messages ------------------------------------------------

export const MODAL = {
  mergeAllTitle:   'Merge All Layers',
  mergeAllMsg:     'This will flatten all layers into one and clear the undo history. This cannot be undone.',
  mergeDownTitle:  'Merge Down',
  mergeDownMsg:    'This will merge the active layer onto the layer below and clear the undo history. This cannot be undone.',
  contrastTitle:   'Contrast',
  saturationTitle: 'Saturation',
  colorRGBTitle:   'Color RGB',
  vibrancyTitle:   'Vibrancy',
  whiteBalTitle:   'White Balance',
  resizeTitle:     'Resize Image',
  canvasSizeTitle: 'Canvas Size',
  unsavedTitle:    'Unsaved Changes',
  newCanvasTitle:  'New Canvas',
} as const

// ---- Modal adjust labels ----------------------------------------------------

export const ADJUST_LABELS = {
  contrast:    'Contrast',
  saturation:  'Saturation',
  vibrancy:    'Vibrancy',
  temperature: 'Temperature',
  tint:        'Tint',
} as const

// ---- Misc UI ----------------------------------------------------------------

export const TAB_LABELS = {
  unsavedDot:  '●',
  unsavedHint: 'Unsaved changes',
  closeTab:    'Close tab',
  newCanvas:   'New canvas',
} as const
