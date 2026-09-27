// ch3/noise3d.js: a tileable 128³ RGBA16F noise volume, baked once on the GPU (deterministic).
//   R: gradient-noise fbm (5 octaves)        G: billowy Worley fbm (puffy cloud cells)
//   B, A: two independent low-frequency fbm fields (domain warp / dust placement)
// Sampling it is a handful of trilinear fetches: far cheaper than analytic simplex per march step.
// It is mipmapped: the march picks an LOD per octave from the pixel footprint (cache-friendly, no aliasing).

export function bakeNoise(ctx, N = 128) {
  const { THREE, glsl, Pass, renderer } = ctx;
  const rt = new THREE.WebGL3DRenderTarget(N, N, N, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
  });
  rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = THREE.RepeatWrapping;
  rt.texture.colorSpace = THREE.NoColorSpace;
  const pass = new Pass(glsl.header + glsl.hash + /* glsl */`
    in vec2 vUv; out vec4 fragColor;
    uniform float zSlice; uniform float res;
    vec3 gradAt(ivec3 c, int P, uint seed) {
      c = ((c % P) + P) % P;
      uvec3 h = pcg3(uvec3(c) + uvec3(seed, seed * 7u, seed * 13u));
      vec3 g = vec3(h) / 4294967295.0 * 2.0 - 1.0;
      return normalize(g + 1e-5);
    }
    float gnoise(vec3 p, int P, uint seed) {            // periodic gradient noise, ~[-1,1]
      ivec3 i = ivec3(floor(p)); vec3 f = fract(p);
      vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float n000 = dot(gradAt(i, P, seed), f);
      float n100 = dot(gradAt(i + ivec3(1,0,0), P, seed), f - vec3(1,0,0));
      float n010 = dot(gradAt(i + ivec3(0,1,0), P, seed), f - vec3(0,1,0));
      float n110 = dot(gradAt(i + ivec3(1,1,0), P, seed), f - vec3(1,1,0));
      float n001 = dot(gradAt(i + ivec3(0,0,1), P, seed), f - vec3(0,0,1));
      float n101 = dot(gradAt(i + ivec3(1,0,1), P, seed), f - vec3(1,0,1));
      float n011 = dot(gradAt(i + ivec3(0,1,1), P, seed), f - vec3(0,1,1));
      float n111 = dot(gradAt(i + ivec3(1,1,1), P, seed), f - vec3(1,1,1));
      return 1.8 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
    }
    float worley(vec3 p, int P, uint seed) {            // periodic F1 distance, ~[0,1]
      ivec3 i = ivec3(floor(p)); vec3 f = fract(p); float d = 9.0;
      for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        ivec3 c = i + ivec3(x, y, z); ivec3 w = ((c % P) + P) % P;
        vec3 o = vec3(pcg3(uvec3(w) + uvec3(seed, seed * 3u, seed * 5u))) / 4294967295.0;
        vec3 r = vec3(x, y, z) + o - f; d = min(d, dot(r, r));
      }
      return sqrt(d);
    }
    float fbmP(vec3 q, int P0, int oct, uint seed) {
      float a = 0.5, s = 0.0, n = 0.0; int P = P0;
      for (int k = 0; k < 6; k++) { if (k >= oct) break; s += a * gnoise(q * float(P), P, seed + uint(k) * 101u); n += a; a *= 0.5; P *= 2; }
      return s / n;
    }
    void main() {
      vec3 q = vec3(gl_FragCoord.xy / res, (zSlice + 0.5) / res);    // [0,1)^3, one period
      float r = fbmP(q, 4, 5, 11u) * 0.5 + 0.5;
      float w = 0.0, a = 0.5, n = 0.0; int P = 5;
      for (int k = 0; k < 3; k++) { w += a * (1.0 - worley(q * float(P), P, 71u + uint(k) * 17u)); n += a; a *= 0.5; P *= 2; }
      w /= n;
      float b = fbmP(q, 3, 4, 301u) * 0.5 + 0.5;
      float c = fbmP(q, 3, 4, 509u) * 0.5 + 0.5;
      fragColor = vec4(r, w, b, c);
    }`, { zSlice: { value: 0 }, res: { value: N } });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Mip levels are allocated up front (generateMipmaps), but only generated once, after the last slice.
  for (let z = 0; z < N; z++) {
    pass.uniforms.zSlice.value = z;
    renderer.setRenderTarget(rt, z);
    rt.texture.generateMipmaps = z === N - 1;
    renderer.render(pass.scene, cam);
  }
  rt.texture.generateMipmaps = false;
  renderer.setRenderTarget(null);
  pass.material.dispose();
  return rt.texture;
}
