export const TOOL_KEYS = {
  paintbrush:  'B',
  eraser:      'E',
  clone:       'C',
  warp:        'W',
  blend:       'F',
  saturation:  'U',
  dodgeBurn:   'D',
  move:        'V',
  moveLayer:   'G',
  rectSelect:  'S',
  lasso:       'L',
  magicWand:   'M',
  eyedropper:  'I',
  fill:        'K',
  clearSelection: 'Esc',
} as const

export const MENU_KEYS = {
  // File
  new:          'CmdOrCtrl+N',
  open:         'CmdOrCtrl+O',
  import:       'CmdOrCtrl+I',
  importNew:    'CmdOrCtrl+Shift+I',
  save:         'CmdOrCtrl+S',
  saveAs:       'CmdOrCtrl+Shift+S',
  export:       'CmdOrCtrl+E',
  // Edit
  undo:         'CmdOrCtrl+Z',
  redo:         'CmdOrCtrl+Shift+Z',
  cut:          'CmdOrCtrl+X',
  copy:         'CmdOrCtrl+C',
  paste:        'CmdOrCtrl+V',
  selectAll:    'CmdOrCtrl+A',
  clearSelection: 'Escape',
  // Layers
  newLayer:     'CmdOrCtrl+Shift+N',
  duplicateLayer: 'CmdOrCtrl+J',
  // View
  fitView:      'CmdOrCtrl+0',
} as const
