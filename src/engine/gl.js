// Thin helpers over Three.js for render targets and fullscreen shader passes.
import * as THREE from '../vendor/three.module.js';
import { fsVert } from './glsl.js';

const triGeo = new THREE.BufferGeometry();
triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** HDR (half-float) or LDR render target. */
export function makeTarget(w, h, { float = true, depth = false, linear = true, wrap = THREE.ClampToEdgeWrapping, format = THREE.RGBAFormat, type } = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
    type: type ?? (float ? THREE.HalfFloatType : THREE.UnsignedByteType),
    format,
    minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: wrap, wrapT: wrap,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

/** A fullscreen fragment pass. `frag` is GLSL ES 3.00 (declare `out vec4 fragColor;`). */
export class Pass {
  constructor(frag, uniforms = {}, { blending = THREE.NoBlending, transparent = false } = {}) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fsVert,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending,
      transparent,
    });
    this.uniforms = this.material.uniforms;
    this.mesh = new THREE.Mesh(triGeo, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  /** Render into `target` (null = canvas). `set` is an object of uniform values to assign first. */
  render(renderer, target, set) {
    if (set) for (const k in set) { if (this.uniforms[k]) this.uniforms[k].value = set[k]; else this.uniforms[k] = { value: set[k] }; }
    renderer.setRenderTarget(target);
    renderer.render(this.scene, orthoCam);
  }
}

export { THREE };
