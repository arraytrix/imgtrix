// Menu bar labels for the Electron main process menu

export const MENU = {
  // Top-level menus
  file:    'File',
  edit:    'Edit',
  image:   'Image',
  adjust:  'Adjust',
  layers:  'Layers',
  view:    'View',
  window:  'Window',

  // File
  new:          'New…',
  open:         'Open…',
  importLayer:  'Import Layer…',
  importAsNew:  'Import as New…',
  save:         'Save',
  saveAs:       'Save As…',
  export:       'Export…',
  exit:         'Exit',

  // Edit
  undo:           'Undo',
  redo:           'Redo',
  cut:            'Cut',
  copy:           'Copy',
  paste:          'Paste',
  selectAll:      'Select All',
  clearSelection: 'Clear Selection',

  // Image
  resizeImage:        'Resize Image…',
  canvasSize:         'Canvas Size…',
  selectionToNew:     'Move Selection to New Image',
  rotate90CW:         'Rotate 90° Clockwise',
  rotate90CCW:        'Rotate 90° Counter-Clockwise',
  rotate180:          'Rotate 180°',

  // Adjust
  contrast:      'Contrast…',
  saturation:    'Saturation…',
  vibrancy:      'Vibrancy…',
  whiteBalance:  'White Balance…',
  colorRGB:      'Color RGB…',

  // Layers
  newLayer:        'New Layer',
  duplicateLayer:  'Duplicate Layer',
  deleteLayer:     'Delete Layer',
  mergeDown:       'Merge Down',
  mergeAll:        'Merge All',
  moveLayerUp:     'Move Layer Up',
  moveLayerDown:   'Move Layer Down',

  // View
  fitToView: 'Fit to View',

  // Settings
  settings:        'Settings',
  hotkeys:         'Hotkeys…',
  restoreDefaults: 'Restore Defaults',
} as const
