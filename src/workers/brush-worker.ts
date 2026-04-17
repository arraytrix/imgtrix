/// <reference lib="webworker" />

// Phase 2: BrushWorker will handle soft brush dab rendering off the main thread.
// See PRD for full message protocol (BrushDabMessage / DabResult).
//
// Phase 1 pencil tool draws directly via Canvas 2D on the main thread.
// Move to this worker in Phase 2 when adding hardness + opacity controls.

export type BrushDabMessage = {
  type: 'brush_dab'
  x: number
  y: number
  radius: number
  hardness: number   // 0–1
  opacity: number    // 0–1
  color: [number, number, number, number]
  destBuffer: ArrayBuffer
  destWidth: number
  destHeight: number
}

export type DabResult = {
  type: 'dab_result'
  buffer: ArrayBuffer
  rect: { x: number; y: number; w: number; h: number }
}

self.onmessage = (_e: MessageEvent<BrushDabMessage>) => {
  // TODO Phase 2: implement dab rendering
}
