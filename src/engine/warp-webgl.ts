// GPU-accelerated bilinear resampling for the warp tool.
//
// The displacement maps stay on the CPU (they're cheap scalar updates).
// This class handles the expensive part: sampling the snapshot texture
// at displaced coordinates — exactly what GPU fragment shaders do natively.
//
// Coordinate system note:
//   With UNPACK_FLIP_Y_WEBGL = false, canvas row py lands at texture UV.y = py/H.
//   Vertex UVs: ((pos.x+1)/2, (pos.y+1)/2) → fragment at framebuffer y=fy gets UV.y = fy/H.
//   Therefore framebuffer y = canvas row (same index), so readPixels(rx, ry, rw, rh)
//   returns rows in correct canvas order — no row-flip needed on readback.

const WARP_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (a_pos.y + 1.0) * 0.5);
}`

const WARP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_snapshot;
uniform sampler2D u_disp;    // RG32F: R = dispX, G = dispY (in canvas pixels)
uniform vec2 u_invSize;      // vec2(1/W, 1/H)
out vec4 outColor;
void main() {
  vec2 d = texture(u_disp, v_uv).rg;
  vec2 sampleUV = v_uv + d * u_invSize;
  // Out-of-bounds → transparent (matches CPU snap() behaviour)
  if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  outColor = texture(u_snapshot, sampleUV);
}`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`WarpWebGL shader error: ${gl.getShaderInfoLog(s)}`)
  return s
}

function makeProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, WARP_VERT))
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, WARP_FRAG))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`WarpWebGL link error: ${gl.getProgramInfoLog(p)}`)
  return p
}

export class WarpWebGL {
  private glCanvas: OffscreenCanvas | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private snapshotTex: WebGLTexture | null = null
  private dispTex: WebGLTexture | null = null
  private uInvSize: WebGLUniformLocation | null = null

  private W = 0
  private H = 0
  private contextReady = false  // GL context + program compiled
  private strokeReady  = false  // textures allocated for current stroke

  // ─── One-time setup ──────────────────────────────────────────────────────
  // Called lazily on first stroke. Creates the GL context and compiles the
  // shader — both survive across strokes.
  private ensureContext(): boolean {
    if (this.contextReady) return true
    try {
      this.glCanvas = new OffscreenCanvas(1, 1)
      const gl = this.glCanvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null
      if (!gl) return false
      this.gl = gl

      this.program = makeProgram(gl)
      gl.useProgram(this.program)

      // Full-screen quad, no Y-flip (UV matches canvas coords directly)
      const verts = new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1])
      const vbo = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)

      this.vao = gl.createVertexArray()!
      gl.bindVertexArray(this.vao)
      const aPos = gl.getAttribLocation(this.program, 'a_pos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 8, 0)

      gl.uniform1i(gl.getUniformLocation(this.program, 'u_snapshot'), 0)
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_disp'),     1)
      this.uInvSize = gl.getUniformLocation(this.program, 'u_invSize')

      this.contextReady = true
      return true
    } catch (e) {
      console.warn('WarpWebGL: context init failed, using CPU fallback:', e)
      this.contextReady = false
      return false
    }
  }

  // ─── Per-stroke setup ────────────────────────────────────────────────────
  // Call at the start of each warp stroke. Uploads the snapshot texture and
  // (re)allocates the displacement texture. Returns false → use CPU fallback.
  beginStroke(W: number, H: number, snapshot: OffscreenCanvas): boolean {
    this.strokeReady = false
    if (!this.ensureContext()) return false
    const gl = this.gl!

    try {
      const sizeChanged = W !== this.W || H !== this.H
      if (sizeChanged) {
        this.W = W
        this.H = H
        this.glCanvas!.width  = W
        this.glCanvas!.height = H
        gl.viewport(0, 0, W, H)
        gl.uniform2f(this.uInvSize!, 1.0 / W, 1.0 / H)

        // Free old textures; they'll be recreated below
        if (this.snapshotTex) { gl.deleteTexture(this.snapshotTex); this.snapshotTex = null }
        if (this.dispTex)     { gl.deleteTexture(this.dispTex);     this.dispTex     = null }
      }

      // Upload snapshot (always fresh — it's the layer state before this stroke)
      if (!this.snapshotTex) this.snapshotTex = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.snapshotTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snapshot)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      // Allocate displacement texture (RG32F, zero-initialised = no displacement)
      if (!this.dispTex) this.dispTex = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.dispTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, W, H, 0, gl.RG, gl.FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      this.strokeReady = true
      return true
    } catch (e) {
      console.warn('WarpWebGL: beginStroke failed, using CPU fallback:', e)
      return false
    }
  }

  // ─── Per-dab: upload displacement sub-region ─────────────────────────────
  // Only uploads the changed rect instead of the full W×H displacement map.
  updateDisp(
    dispX: Float32Array, dispY: Float32Array,
    x0: number, y0: number, x1: number, y1: number
  ): void {
    if (!this.strokeReady) return
    const gl = this.gl!
    const W  = this.W
    const tw = x1 - x0 + 1
    const th = y1 - y0 + 1

    // Interleave dispX / dispY into a RG32F sub-image
    const sub = new Float32Array(tw * th * 2)
    for (let row = 0; row < th; row++) {
      for (let col = 0; col < tw; col++) {
        const si = (y0 + row) * W + (x0 + col)
        const di = (row * tw + col) * 2
        sub[di]     = dispX[si]
        sub[di + 1] = dispY[si]
      }
    }

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.dispTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, tw, th, gl.RG, gl.FLOAT, sub)
  }

  // ─── Per-dab: render and read back the affected region ───────────────────
  // Returns a Uint8ClampedArray of rw×rh×4 bytes ready for putImageData,
  // or null if the GL path is not ready.
  render(rx0: number, ry0: number, rw: number, rh: number): Uint8ClampedArray | null {
    if (!this.strokeReady) return null
    const gl = this.gl!

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.snapshotTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.dispTex)

    // Scissor to only run fragments in the affected rect
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(rx0, ry0, rw, rh)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.SCISSOR_TEST)

    // readPixels(x, y, w, h): y measured from framebuffer bottom.
    // Framebuffer y = canvas row (same index in our setup), so no row-flip needed.
    const result = new Uint8ClampedArray(rw * rh * 4)
    gl.readPixels(rx0, ry0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, result)
    return result
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  // Call when the WarpTool is no longer needed (e.g. tool switch, app shutdown).
  // Stroke-to-stroke cleanup is not needed — textures are reused.
  dispose(): void {
    const gl = this.gl
    if (!gl) return
    if (this.snapshotTex) gl.deleteTexture(this.snapshotTex)
    if (this.dispTex)     gl.deleteTexture(this.dispTex)
    if (this.program)     gl.deleteProgram(this.program)
    if (this.vao)         gl.deleteVertexArray(this.vao)
    this.gl           = null
    this.glCanvas     = null
    this.snapshotTex  = null
    this.dispTex      = null
    this.program      = null
    this.vao          = null
    this.contextReady = false
    this.strokeReady  = false
  }
}
