export type Selection =
  | { type: 'rect';  x: number; y: number; w: number; h: number }
  | { type: 'lasso'; points: { x: number; y: number }[] }
  | { type: 'mask';  x: number; y: number; w: number; h: number; data: Uint8Array }
