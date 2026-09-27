// VI · LIFE: sun shadow maps (two orthographic cascades) for the above-water world.
import { THREE } from '../../engine/gl.js';

export function makeShadowUniforms() {
  return {
    uSh0: { value: null }, uSh1: { value: null },
    uShM0: { value: new THREE.Matrix4() }, uShM1: { value: new THREE.Matrix4() },
    uShOn: { value: 0 }, uShTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  };
}

export const GL_SHADOW = /* glsl */`
uniform sampler2D uSh0, uSh1; uniform mat4 uShM0, uShM1; uniform float uShOn; uniform vec2 uShTexel;
float _pcf(sampler2D tex, vec3 s, float bias) {
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float d = texture(tex, s.xy + vec2(float(x), float(y)) * uShTexel * 1.25).r;
    lit += s.z - bias <= d ? 1.0 : 0.0;
  }
  return lit / 9.0;
}
float sunShadow(vec3 p, vec3 n) {
  if (uShOn < 0.5) return 1.0;
  vec3 q = p + n * 0.02;
  vec4 c0 = uShM0 * vec4(q, 1.0);
  vec3 s0 = c0.xyz / c0.w * 0.5 + 0.5;
  if (all(greaterThan(s0.xy, vec2(0.01))) && all(lessThan(s0.xy, vec2(0.99))) && s0.z < 1.0) return _pcf(uSh0, s0, 0.0006);
  vec4 c1 = uShM1 * vec4(q, 1.0);
  vec3 s1 = c1.xyz / c1.w * 0.5 + 0.5;
  if (all(greaterThan(s1.xy, vec2(0.0))) && all(lessThan(s1.xy, vec2(1.0))) && s1.z < 1.0) return _pcf(uSh1, s1, 0.0012);
  return 1.0;
}
`;

export function makeSunShadow(U, { size = 2048, near = [0, 1.5, -18], nearHalf = 26, far = [0, 4, -60], farHalf = 95 } = {}) {
  const mk = () => {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    rt.depthTexture = new THREE.DepthTexture(size, size);
    rt.depthTexture.type = THREE.UnsignedIntType;
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    return rt;
  };
  const rts = [mk(), mk()];
  const cams = [new THREE.OrthographicCamera(-nearHalf, nearHalf, nearHalf, -nearHalf, 1, 500), new THREE.OrthographicCamera(-farHalf, farHalf, farHalf, -farHalf, 1, 700)];
  const centres = [new THREE.Vector3(...near), new THREE.Vector3(...far)];
  const scene = new THREE.Scene();
  U.uSh0.value = rts[0].depthTexture; U.uSh1.value = rts[1].depthTexture;
  U.uShTexel.value.set(1 / size, 1 / size);
  const tmp = new THREE.Vector3();
  return {
    scene,
    render(r, sunDir) {
      for (let i = 0; i < 2; i++) {
        const cam = cams[i];
        tmp.copy(sunDir).multiplyScalar(i === 0 ? 150 : 300).add(centres[i]);
        cam.position.copy(tmp);
        cam.up.set(0, 1, 0);
        cam.lookAt(centres[i]);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        r.setRenderTarget(rts[i]);
        r.setClearColor(0xffffff, 1);
        r.clear(true, true, false);
        r.render(scene, cam);
        (i === 0 ? U.uShM0 : U.uShM1).value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      }
      r.setClearColor(0x000000, 1);
      U.uShOn.value = 1;
    },
  };
}
