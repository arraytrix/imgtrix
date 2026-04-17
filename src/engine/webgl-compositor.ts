import type { LayerStack } from './layer-stack'
import type { BlendMode, Layer } from './layer'

// ─── Blend mode integer codes ────────────────────────────────────────────────
const BLEND: Record<BlendMode, number> = {
  'normal':      0,
  'multiply':    1,
  'screen':      2,
  'overlay':     3,
  'darken':      4,
  'lighten':     5,
  'color-dodge': 6,
  'color-burn':  7,
  'hard-light':  8,
  'soft-light':  9,
  'difference':  10,
  'exclusion':   11,
}

const CHECKER_SIZE  = 12
const CHECKER_LIGHT = '#ffffff'
const CHECKER_DARK  = '#cccccc'

const checkerSource = (() => {
  const c = new OffscreenCanvas(CHECKER_SIZE * 2, CHECKER_SIZE * 2)
  const g = c.getContext('2d')!
  g.fillStyle = CHECKER_LIGHT
  g.fillRect(0, 0, CHECKER_SIZE * 2, CHECKER_SIZE * 2)
  g.fillStyle = CHECKER_DARK
  g.fillRect(0,            0,            CHECKER_SIZE, CHECKER_SIZE)
  g.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE)
  return c
})()

// ─── Shaders ─────────────────────────────────────────────────────────────────
const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform float u_opacity;
uniform int u_blendMode;
uniform vec2 u_uvOffset;
uniform vec2 u_layerScale;
out vec4 outColor;

vec3 bMultiply (vec3 s, vec3 d) { return s * d; }
vec3 bScreen   (vec3 s, vec3 d) { return s + d - s * d; }
vec3 bOverlay  (vec3 s, vec3 d) {
  return vec3(
    d.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
    d.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
    d.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b));
}
vec3 bDarken   (vec3 s, vec3 d) { return min(s, d); }
vec3 bLighten  (vec3 s, vec3 d) { return max(s, d); }
vec3 bColorDodge(vec3 s, vec3 d) {
  return vec3(
    s.r >= 1.0 ? 1.0 : min(1.0, d.r/(1.0-s.r)),
    s.g >= 1.0 ? 1.0 : min(1.0, d.g/(1.0-s.g)),
    s.b >= 1.0 ? 1.0 : min(1.0, d.b/(1.0-s.b)));
}
vec3 bColorBurn(vec3 s, vec3 d) {
  return vec3(
    s.r <= 0.0 ? 0.0 : 1.0-min(1.0,(1.0-d.r)/s.r),
    s.g <= 0.0 ? 0.0 : 1.0-min(1.0,(1.0-d.g)/s.g),
    s.b <= 0.0 ? 0.0 : 1.0-min(1.0,(1.0-d.b)/s.b));
}
vec3 bHardLight(vec3 s, vec3 d) {
  return vec3(
    s.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
    s.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
    s.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b));
}
vec3 bSoftLight(vec3 s, vec3 d) {
  vec3 q = vec3(
    d.r <= 0.25 ? ((16.0*d.r-12.0)*d.r+4.0)*d.r : sqrt(d.r),
    d.g <= 0.25 ? ((16.0*d.g-12.0)*d.g+4.0)*d.g : sqrt(d.g),
    d.b <= 0.25 ? ((16.0*d.b-12.0)*d.b+4.0)*d.b : sqrt(d.b));
  return vec3(
    s.r <= 0.5 ? d.r-(1.0-2.0*s.r)*d.r*(1.0-d.r) : d.r+(2.0*s.r-1.0)*(q.r-d.r),
    s.g <= 0.5 ? d.g-(1.0-2.0*s.g)*d.g*(1.0-d.g) : d.g+(2.0*s.g-1.0)*(q.g-d.g),
    s.b <= 0.5 ? d.b-(1.0-2.0*s.b)*d.b*(1.0-d.b) : d.b+(2.0*s.b-1.0)*(q.b-d.b));
}
vec3 bDiff     (vec3 s, vec3 d) { return abs(s-d); }
vec3 bExcl     (vec3 s, vec3 d) { return s+d-2.0*s*d; }

vec3 applyBlend(int m, vec3 s, vec3 d) {
  if      (m == 1)  return bMultiply(s,d);
  else if (m == 2)  return bScreen(s,d);
  else if (m == 3)  return bOverlay(s,d);
  else if (m == 4)  return bDarken(s,d);
  else if (m == 5)  return bLighten(s,d);
  else if (m == 6)  return bColorDodge(s,d);
  else if (m == 7)  return bColorBurn(s,d);
  else if (m == 8)  return bHardLight(s,d);
  else if (m == 9)  return bSoftLight(s,d);
  else if (m == 10) return bDiff(s,d);
  else if (m == 11) return bExcl(s,d);
  else              return s;
}

void main() {
  // Map document UV → layer UV, accounting for layer offset and size
  vec2 layerUV = (v_uv - u_uvOffset) / u_layerScale;
  // Out-of-bounds = transparent
  // u_dst is an FBO texture whose y-origin is opposite to canvas textures, so sample with flipped v
  vec2 dstUV = vec2(v_uv.x, 1.0 - v_uv.y);
  if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
    outColor = texture(u_dst, dstUV);
    return;
  }

  vec4 srcPre = texture(u_src, layerUV);
  vec4 dstPre = texture(u_dst, dstUV);

  float srcA = srcPre.a * u_opacity;
  if (srcA == 0.0) { outColor = dstPre; return; }

  // Un-premultiply for blend computation
  vec3 src = srcPre.a > 0.0 ? srcPre.rgb / srcPre.a : vec3(0.0);
  vec3 dst = dstPre.a > 0.0 ? dstPre.rgb / dstPre.a : vec3(0.0);

  vec3 blended = applyBlend(u_blendMode, src, dst);

  // Porter-Duff source-over with blended colour, output premultiplied
  float outA  = srcA + dstPre.a * (1.0 - srcA);
  vec3  outRGB = outA > 0.0
    ? (blended * srcA + dst * dstPre.a * (1.0 - srcA)) / outA
    : vec3(0.0);

  outColor = vec4(outRGB * outA, outA);
}`

// ─── Helper ──────────────────────────────────────────────────────────────────
function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(s)}`)
  return s
}

function makeProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`)
  return p
}

interface FBO { fbo: WebGLFramebuffer; tex: WebGLTexture }

// ─── WebGLCompositor ─────────────────────────────────────────────────────────
export class WebGLCompositor {
  // Intermediate OffscreenCanvas used for GPU compositing
  private glCanvas: OffscreenCanvas | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null

  // Ping-pong FBOs (sized to document canvas)
  private fboA: FBO | null = null
  private fboB: FBO | null = null
  private docW = 0
  private docH = 0

  // Uniform locations
  private uDst        = -1 as unknown as WebGLUniformLocation
  private uSrc        = -1 as unknown as WebGLUniformLocation
  private uOpacity    = -1 as unknown as WebGLUniformLocation
  private uBlendMode  = -1 as unknown as WebGLUniformLocation
  private uUvOffset   = -1 as unknown as WebGLUniformLocation
  private uLayerScale = -1 as unknown as WebGLUniformLocation

  // Layer texture cache: layer.id → WebGLTexture (only re-uploaded when layer.gpuDirty)
  private texCache = new Map<string, WebGLTexture>()

  // Checker pattern cache (one per Canvas2D context)
  private checkerPattern: CanvasPattern | null = null
  private checkerCtx: CanvasRenderingContext2D | null = null

  // Falls back to CPU compositor if WebGL2 is unavailable
  private cpuFallback = false

  private ensureGL(docW: number, docH: number): boolean {
    if (this.cpuFallback) return false

    // Rebuild if document size changed
    if (this.gl && (this.docW !== docW || this.docH !== docH)) {
      this.rebuildFBOs(docW, docH)
      return true
    }

    if (this.gl) return true

    // First-time init
    try {
      this.glCanvas = new OffscreenCanvas(docW, docH)
      const gl = this.glCanvas.getContext('webgl2', {
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
      }) as WebGL2RenderingContext | null
      if (!gl) { this.cpuFallback = true; return false }
      this.gl = gl

      this.program = makeProgram(gl)
      gl.useProgram(this.program)

      // Full-screen quad covering clip space [-1,1] × [-1,1]
      // UV y is flipped (1-y) so that the output matches Canvas2D's Y-down orientation
      // when drawn via ctx.drawImage(glCanvas).
      const verts = new Float32Array([
        // x     y     u    v
        -1, -1,  0.0, 1.0,
         1, -1,  1.0, 1.0,
        -1,  1,  0.0, 0.0,
         1,  1,  1.0, 0.0,
      ])
      const vbo = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)

      this.vao = gl.createVertexArray()!
      gl.bindVertexArray(this.vao)
      const aPos = gl.getAttribLocation(this.program, 'a_pos')
      const aUV  = gl.getAttribLocation(this.program, 'a_uv')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
      gl.enableVertexAttribArray(aUV)
      gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8)

      this.uDst        = gl.getUniformLocation(this.program, 'u_dst')!
      this.uSrc        = gl.getUniformLocation(this.program, 'u_src')!
      this.uOpacity    = gl.getUniformLocation(this.program, 'u_opacity')!
      this.uBlendMode  = gl.getUniformLocation(this.program, 'u_blendMode')!
      this.uUvOffset   = gl.getUniformLocation(this.program, 'u_uvOffset')!
      this.uLayerScale = gl.getUniformLocation(this.program, 'u_layerScale')!

      gl.uniform1i(this.uDst, 0)  // texture unit 0
      gl.uniform1i(this.uSrc, 1)  // texture unit 1

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ZERO)  // FBO output is pre-multiplied, no additional blend

      this.rebuildFBOs(docW, docH)
    } catch (e) {
      console.warn('WebGL compositor init failed, falling back to CPU:', e)
      this.cpuFallback = true
      return false
    }
    return true
  }

  private rebuildFBOs(w: number, h: number): void {
    const gl = this.gl!
    this.docW = w
    this.docH = h

    // Resize glCanvas
    if (this.glCanvas) {
      this.glCanvas.width  = w
      this.glCanvas.height = h
    }

    const mkFBO = (): FBO => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { fbo, tex }
    }

    // Delete old FBOs if they exist
    if (this.fboA) { gl.deleteFramebuffer(this.fboA.fbo); gl.deleteTexture(this.fboA.tex) }
    if (this.fboB) { gl.deleteFramebuffer(this.fboB.fbo); gl.deleteTexture(this.fboB.tex) }

    // Purge layer texture cache — doc size changed, all layers will need re-upload
    for (const tex of this.texCache.values()) gl.deleteTexture(tex)
    this.texCache.clear()

    this.fboA = mkFBO()
    this.fboB = mkFBO()
  }

  private texParams(gl: WebGL2RenderingContext): void {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  // Returns a cached WebGLTexture for the layer, re-uploading only when layer.gpuDirty.
  private getLayerTexture(gl: WebGL2RenderingContext, layer: Layer): WebGLTexture {
    const cached = this.texCache.get(layer.id)
    if (cached && !layer.gpuDirty) return cached

    // Delete stale cached texture before re-upload
    if (cached) gl.deleteTexture(cached)

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.canvas)
    this.texParams(gl)
    this.texCache.set(layer.id, tex)
    layer.gpuDirty = false
    return tex
  }

  // Uploads an OffscreenCanvas without caching (used for the stroke canvas overlay).
  private uploadCanvas(gl: WebGL2RenderingContext, canvas: OffscreenCanvas): WebGLTexture {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    this.texParams(gl)
    return tex
  }

  private compositeGL(
    stack: LayerStack,
    strokeCanvas: OffscreenCanvas | null,
    strokeOpacity: number
  ): void {
    const gl = this.gl!
    const W = this.docW, H = this.docH

    gl.viewport(0, 0, W, H)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    // Evict cached textures for layers that no longer exist in the stack
    const currentIds = new Set(stack.layers.map(l => l.id))
    for (const [id, tex] of this.texCache) {
      if (!currentIds.has(id)) { gl.deleteTexture(tex); this.texCache.delete(id) }
    }

    // Get textures for visible layers (cached unless gpuDirty)
    const layerTextures: Array<{ tex: WebGLTexture; layer: typeof stack.layers[0] }> = []
    for (const layer of stack.layers) {
      if (!layer.visible) continue
      layerTextures.push({ tex: this.getLayerTexture(gl, layer), layer })
    }

    let strokeTex: WebGLTexture | null = null
    if (strokeCanvas) strokeTex = this.uploadCanvas(gl, strokeCanvas)

    let curr = this.fboA!
    let next = this.fboB!

    // Clear accumulation to transparent
    gl.bindFramebuffer(gl.FRAMEBUFFER, curr.fbo)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Composite layers bottom-to-top
    for (let li = 0; li < layerTextures.length; li++) {
      const { tex, layer } = layerTextures[li]
      const isActive = stack.layers.indexOf(layer) === stack.activeIndex

      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, curr.tex)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, tex)

      gl.uniform1f(this.uOpacity,    layer.opacity)
      gl.uniform1i(this.uBlendMode,  BLEND[layer.blendMode])
      gl.uniform2f(this.uUvOffset,   layer.offsetX / W, layer.offsetY / H)
      gl.uniform2f(this.uLayerScale, layer.canvas.width / W, layer.canvas.height / H)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      [curr, next] = [next, curr]

      // Composite stroke overlay on top of active layer
      if (isActive && strokeTex) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, curr.tex)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, strokeTex)

        gl.uniform1f(this.uOpacity,    strokeOpacity)
        gl.uniform1i(this.uBlendMode,  BLEND['normal'])
        gl.uniform2f(this.uUvOffset,   0, 0)
        gl.uniform2f(this.uLayerScale, 1, 1)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [curr, next] = [next, curr]
      }
    }

    // Blit final accumulation to glCanvas default framebuffer
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, curr.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST)

    // Layer textures are cached — do not delete them. Only clean up the stroke texture.
    if (strokeTex) gl.deleteTexture(strokeTex)
  }

  private drawChecker(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number): void {
    if (ctx !== this.checkerCtx) {
      this.checkerPattern = ctx.createPattern(checkerSource, 'repeat')
      this.checkerCtx = ctx
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()
    ctx.fillStyle = this.checkerPattern!
    ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()
  }

  composite(
    stack: LayerStack,
    strokeCanvas: OffscreenCanvas | null,
    strokeOpacity: number,
    target: HTMLCanvasElement,
    vp: { offsetX: number; offsetY: number; zoom: number }
  ): void {
    const docW = stack.width
    const docH = stack.height

    if (!this.ensureGL(docW, docH)) {
      // CPU fallback (should not happen in Electron/Chromium)
      this.cpuComposite(stack, strokeCanvas, strokeOpacity, target, vp)
      return
    }

    this.compositeGL(stack, strokeCanvas, strokeOpacity)

    // Draw result onto 2D display canvas
    const ctx = target.getContext('2d')!
    ctx.clearRect(0, 0, target.width, target.height)

    const sx = vp.offsetX
    const sy = vp.offsetY
    const sw = docW * vp.zoom
    const sh = docH * vp.zoom

    // Shadow behind document
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 4
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()

    // Checkerboard (screen-space, constant size at all zoom levels)
    this.drawChecker(ctx, sx, sy, sw, sh)

    // Draw the WebGL-composited result.
    ctx.drawImage(this.glCanvas!, sx, sy, sw, sh)
  }

  // ─── CPU fallback (identical to original Compositor) ──────────────────────
  private cpuComposite(
    stack: LayerStack,
    strokeCanvas: OffscreenCanvas | null,
    strokeOpacity: number,
    target: HTMLCanvasElement,
    vp: { offsetX: number; offsetY: number; zoom: number }
  ): void {
    const ctx = target.getContext('2d')!
    ctx.clearRect(0, 0, target.width, target.height)

    const sx = vp.offsetX, sy = vp.offsetY
    const sw = stack.width * vp.zoom, sh = stack.height * vp.zoom

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
    ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy, sw, sh)
    ctx.restore()

    this.drawChecker(ctx, sx, sy, sw, sh)

    ctx.save()
    ctx.translate(vp.offsetX, vp.offsetY); ctx.scale(vp.zoom, vp.zoom)
    ctx.beginPath(); ctx.rect(0, 0, stack.width, stack.height); ctx.clip()
    for (let i = 0; i < stack.layers.length; i++) {
      const layer = stack.layers[i]
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode as GlobalCompositeOperation
      ctx.drawImage(layer.canvas, layer.offsetX, layer.offsetY)
      if (i === stack.activeIndex && strokeCanvas) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = strokeOpacity
        ctx.drawImage(strokeCanvas, 0, 0)
      }
      ctx.restore()
    }
    ctx.restore()
  }
}
