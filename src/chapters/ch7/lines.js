// Instanced GPU line segments (analytic capsule profile, MAX-blended so polylines have no
// bead artefacts at joints) and additive glow sprites. All coordinates are target pixels,
// GL convention (origin bottom-left, y up). Geometry is rebuilt on the CPU every frame
// from pure functions of t, then uploaded once.

const SEG_VS = /* glsl */`
precision highp float;
in vec3 position;
in vec4 aSeg; in vec2 aW; in vec3 aC0; in vec3 aC1;
uniform vec2 res; uniform float halo;
out vec2 vP; out vec4 vSeg; out vec2 vW; out vec3 vC0; out vec3 vC1;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float L = length(d);
  vec2 u = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float R = max(aW.x, aW.y) + halo * 3.0 + 1.5;
  vec2 p = mix(a - u * R, b + u * R, position.x) + n * position.y * R;
  vP = p; vSeg = aSeg; vW = aW; vC0 = aC0; vC1 = aC1;
  gl_Position = vec4(p / res * 2.0 - 1.0, 0.0, 1.0);
}`;

const SEG_FS = /* glsl */`
precision highp float;
in vec2 vP; in vec4 vSeg; in vec2 vW; in vec3 vC0; in vec3 vC1;
uniform float halo; uniform float haloAmt;
out vec4 fragColor;
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw;
  vec2 pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float w = mix(vW.x, vW.y, h);
  float we = max(w, 0.55);
  float cov = clamp(we + 0.5 - d, 0.0, 1.0) * (w / we);      // thin lines get dimmer, not aliased
  float hal = halo > 0.0 ? exp(-d * d / (2.0 * halo * halo)) * haloAmt * min(1.0, w / 0.6) : 0.0;
  vec3 c = mix(vC0, vC1, h) * (cov + hal);
  fragColor = vec4(c, 1.0);
}`;

const SPR_VS = /* glsl */`
precision highp float;
in vec3 position;
in vec4 aS; in vec3 aC; in float aG;
uniform vec2 res;
out vec2 vD; out vec4 vS; out vec3 vCol; out float vG;
void main() {
  float R = max(aS.z + 1.5, aS.w * 3.2);
  vec2 p = aS.xy + position.xy * R;
  vD = position.xy * R; vS = aS; vCol = aC; vG = aG;
  gl_Position = vec4(p / res * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPR_FS = /* glsl */`
precision highp float;
in vec2 vD; in vec4 vS; in vec3 vCol; in float vG;
out vec4 fragColor;
void main() {
  float d = length(vD);
  float rc = vS.z, sg = max(vS.w, 0.3);
  float core = rc > 0.0 ? clamp(max(rc, 0.6) + 0.5 - d, 0.0, 1.0) * min(1.0, rc / 0.6) : 0.0;
  float glow = exp(-d * d / (2.0 * sg * sg)) * vG;
  fragColor = vec4(vCol * (core + glow), 1.0);
}`;

export class SegBatch {
  constructor(ctx, capacity = 120000, mode = 'max') {
    const { THREE } = ctx;
    this.THREE = THREE;
    this.cap = capacity;
    this.stride = 12;
    this.data = new Float32Array(capacity * this.stride);
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ib = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSeg', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('aW', new THREE.InterleavedBufferAttribute(ib, 2, 4));
    g.setAttribute('aC0', new THREE.InterleavedBufferAttribute(ib, 3, 6));
    g.setAttribute('aC1', new THREE.InterleavedBufferAttribute(ib, 3, 9));
    g.instanceCount = 0;
    this.ib = ib; this.geo = g;
    const blend = mode === 'max'
      ? { blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }
      : { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SEG_VS, fragmentShader: SEG_FS,
      uniforms: { res: { value: new THREE.Vector2(ctx.W, ctx.H) }, halo: { value: 2.2 }, haloAmt: { value: 0.12 } },
      depthTest: false, depthWrite: false, transparent: true, ...blend,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  begin() { this.n = 0; }
  /** Segment (x0,y0)→(x1,y1), half-widths w0/w1, linear colours c0/c1 (already × intensity). */
  seg(x0, y0, x1, y1, w0, w1, r0, g0, b0, r1, g1, b1) {
    if (this.n >= this.cap) return;
    const o = this.n++ * 12, D = this.data;
    D[o] = x0; D[o + 1] = y0; D[o + 2] = x1; D[o + 3] = y1; D[o + 4] = w0; D[o + 5] = w1;
    D[o + 6] = r0; D[o + 7] = g0; D[o + 8] = b0; D[o + 9] = r1; D[o + 10] = g1; D[o + 11] = b1;
  }
  render(renderer, target, halo = 2.2, haloAmt = 0.12) {
    if (!this.n) return;
    this.geo.instanceCount = this.n;
    this.ib.clearUpdateRanges();
    this.ib.addUpdateRange(0, this.n * this.stride);
    this.ib.needsUpdate = true;
    this.mat.uniforms.res.value.set(target.width, target.height);
    this.mat.uniforms.halo.value = halo;
    this.mat.uniforms.haloAmt.value = haloAmt;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}

export class SpriteBatch {
  constructor(ctx, capacity = 40000) {
    const { THREE } = ctx;
    this.cap = capacity;
    this.stride = 8;
    this.data = new Float32Array(capacity * this.stride);
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ib = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aS', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('aC', new THREE.InterleavedBufferAttribute(ib, 3, 4));
    g.setAttribute('aG', new THREE.InterleavedBufferAttribute(ib, 1, 7));
    g.instanceCount = 0;
    this.ib = ib; this.geo = g;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SPR_VS, fragmentShader: SPR_FS,
      uniforms: { res: { value: new THREE.Vector2(ctx.W, ctx.H) } },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  begin() { this.n = 0; }
  /** Sprite at (x,y) px: hard core of radius rc (px) with colour c × 1, plus gaussian glow σ, × g. */
  add(x, y, rc, sigma, r, g, b, glow = 1) {
    if (this.n >= this.cap) return;
    const o = this.n++ * 8, D = this.data;
    D[o] = x; D[o + 1] = y; D[o + 2] = rc; D[o + 3] = sigma; D[o + 4] = r; D[o + 5] = g; D[o + 6] = b; D[o + 7] = glow;
  }
  render(renderer, target) {
    if (!this.n) return;
    this.geo.instanceCount = this.n;
    this.ib.clearUpdateRanges();
    this.ib.addUpdateRange(0, this.n * this.stride);
    this.ib.needsUpdate = true;
    this.mat.uniforms.res.value.set(target.width, target.height);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}
