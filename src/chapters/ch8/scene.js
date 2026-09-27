// VIII · THE PROMPT: the dark room. A unibody laptop on a walnut desk, lit by its own display
// (an LTC rect-area light whose radiance follows the screen), a warm keyboard backlight, a cool
// sliver of moonlight, and a faint window of out-of-focus city lights behind.
import { RectAreaLightUniformsLib } from './RectAreaLightUniformsLib.js';
import { roundedSlab, roundedRectPlane } from './geom.js';
import {
  BASE, LID, LID_TILT, HINGE, DISPLAY, KB, KEYS, keyRect, WELL, PAD, SCREEN_C, SCREEN_N,
} from './layout.js';

const SRGB_TO_LIN = /* glsl */`
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`;

export function buildScene(ctx) {
  const { THREE, T, FONTS, renderer } = ctx;
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene();
  scene.background = null;
  const S = {};                                   // handles returned to the chapter

  // ---------------------------------------------------------------- environment (dim room)
  {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.0065, 0.008), side: THREE.BackSide }));
    room.position.y = 1.5;
    env.add(room);
    const panel = (w, h, col, pos, look) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.set(...pos); m.lookAt(...look); env.add(m);
    };
    panel(1.6, 1.2, new THREE.Color(0.10, 0.14, 0.24), [-3.2, 1.6, -3.0], [0, 0.5, 0]);     // cool window, back-left
    panel(0.8, 0.8, new THREE.Color(0.55, 0.33, 0.16), [3.6, 1.0, -1.5], [0, 0.5, 0]);      // warm lamp glow, right
    panel(3.0, 0.6, new THREE.Color(0.035, 0.04, 0.05), [0, 3.4, 0], [0, 0, 0]);            // ceiling bounce
    const pm = new THREE.PMREMGenerator(renderer);
    S.envRT = pm.fromScene(env, 0.02);
    pm.dispose();
    scene.environment = null;             // per-material envMap + intensity instead (see S.envMats)
  }

  // ---------------------------------------------------------------- materials
  const alu = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#c9ccd1'), metalness: 1.0, roughness: 0.34, specularIntensity: 1 });
  const blackGlass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.004, 0.004, 0.005), metalness: 0, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.04 });
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.012, 0.013), roughness: 0.75 });
  const hingeMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.02, 0.021, 0.023), metalness: 0.6, roughness: 0.42 });

  // ---------------------------------------------------------------- laptop base
  const laptop = new THREE.Group();
  scene.add(laptop);
  const base = new THREE.Mesh(roundedSlab(THREE, BASE.w, BASE.d, BASE.h, BASE.planR, BASE.edgeR, { segC: 12, segE: 6 }), alu);
  base.position.y = BASE.h / 2;
  laptop.add(base);

  // keyboard well: black tray with the backlight bleeding through the key gaps
  const wellTex = keyGlowTexture(THREE);
  const well = new THREE.Mesh(roundedRectPlane(THREE, WELL.w, WELL.d, WELL.r), new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.006, 0.006, 0.007), roughness: 0.85, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveMap: wellTex, emissiveIntensity: 0,
  }));
  well.position.set(WELL.x, BASE.h + 0.00004, WELL.z);
  laptop.add(well);

  // keys: one merged mesh; per-vertex key index → depression + legend glow in the shader
  const atlas = legendAtlas(THREE, FONTS);
  const keyGeo = buildKeys(THREE, atlas);
  const keyUniforms = {
    uPress: { value: new Float32Array(KEYS.length) },
    uTravel: { value: KB.travel },
    uLegend: { value: atlas.tex },
    uBacklight: { value: new THREE.Color(1.0, 0.78, 0.52) },
    uBack: { value: 0 },
  };
  const keyMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.018, 0.018, 0.02), roughness: 0.5, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  keyMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, keyUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float keyIdx; attribute vec2 legendUv; uniform float uPress[${KEYS.length}]; uniform float uTravel; varying vec2 vLegUv; varying float vPress; varying float vTop;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n float pr = uPress[int(keyIdx + 0.5)]; transformed.y -= pr * uTravel; vPress = pr; vLegUv = legendUv; vTop = normal.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uLegend; uniform vec3 uBacklight; uniform float uBack; varying vec2 vLegUv; varying float vPress; varying float vTop;`)
      .replace('#include <opaque_fragment>', `
        float leg = texture2D(uLegend, vLegUv).r * smoothstep(0.6, 0.95, vTop);
        outgoingLight += uBacklight * uBack * leg * (0.32 + 2.6 * vPress * vPress);
        #include <opaque_fragment>`);
  };
  const keys = new THREE.Mesh(keyGeo, keyMat);
  laptop.add(keys);
  S.keyUniforms = keyUniforms;

  // trackpad: glass, a hair proud of the deck, with a dark gap ring
  const padGap = new THREE.Mesh(roundedRectPlane(THREE, PAD.w + 0.0012, PAD.d + 0.0012, PAD.r + 0.0006), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.031, 0.034), roughness: 0.6, metalness: 0.2 }));
  padGap.position.set(0, BASE.h + 0.00003, PAD.z);
  const pad = new THREE.Mesh(roundedRectPlane(THREE, PAD.w, PAD.d, PAD.r), new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#b8bcc2'), metalness: 0.55, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.18 }));
  pad.position.set(0, BASE.h + 0.00008, PAD.z);
  laptop.add(padGap, pad);

  // hinge barrel
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(HINGE.r, HINGE.r, HINGE.len, 24), hingeMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, HINGE.y, HINGE.z);
  laptop.add(hinge);

  // ---------------------------------------------------------------- lid
  const lid = new THREE.Group();
  lid.position.set(0, HINGE.y, HINGE.z);
  lid.rotation.x = -LID_TILT;
  laptop.add(lid);
  const lidBody = new THREE.Mesh(roundedSlab(THREE, LID.w, LID.h, LID.t, LID.planR, LID.edgeR, { segC: 12, segE: 5 }), alu);
  lidBody.rotation.x = -Math.PI / 2;               // slab (x, y, z) → lid (x, z, −y): plan → display face
  lidBody.position.set(0, LID.y0 + LID.h / 2, LID.zc);
  lid.add(lidBody);
  // rubber gasket + black glass
  const gasket = new THREE.Mesh(roundedRectPlane(THREE, LID.w - 0.0016, LID.h - 0.0016, LID.planR - 0.0008), rubber);
  const glass = new THREE.Mesh(roundedRectPlane(THREE, LID.w - 0.0048, LID.h - 0.0048, LID.planR - 0.0024), blackGlass);
  // panel light bleeding into the cover glass: a soft glow hugging the display edge
  const glassUniforms = { uBleed: { value: 0 } };
  const dy = DISPLAY.yc - (LID.y0 + LID.h / 2);
  blackGlass.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, glassUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLoc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLoc; uniform float uBleed;')
      .replace('#include <opaque_fragment>', `
        vec2 dq = abs(vLoc - vec2(0.0, ${dy.toFixed(6)})) - vec2(${(DISPLAY.w / 2).toFixed(6)}, ${(DISPLAY.h / 2).toFixed(6)});
        float dd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
        outgoingLight += vec3(0.62, 0.72, 1.0) * uBleed * (exp(-max(dd, 0.0) / 0.0013) * 0.62 + exp(-max(dd, 0.0) / 0.005) * 0.2);
        #include <opaque_fragment>`);
  };
  S.glassUniforms = glassUniforms;
  for (const [m, dz] of [[gasket, 0.00003], [glass, 0.00006]]) {
    m.geometry.rotateX(Math.PI / 2);                 // xz plane (normal +y) → xy plane (normal +z)
    m.position.set(0, LID.y0 + LID.h / 2, LID.zc + LID.t / 2 + dz);
    lid.add(m);
  }

  // display: emissive shader (UI canvas, nested film, caret glow)
  const displayUniforms = {
    uUI: { value: null }, uVideo: { value: null }, uVideoOn: { value: 0 }, uVideoSize: { value: new THREE.Vector2(1920, 1080) },
    uVideoRect: { value: new THREE.Vector4(0, 0, 1, 1) },      // x0, y0, x1, y1 in display uv (v up)
    uCursorRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCursor: { value: new THREE.Vector3(0, 0, 0) },
    uWake: { value: 1 }, uGain: { value: 1 }, uRefl: { value: 0 },
  };
  const displayMat = new THREE.ShaderMaterial({
    uniforms: displayUniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SRGB_TO_LIN + /* glsl */`
      varying vec2 vUv;
      uniform sampler2D uUI; uniform sampler2D uVideo; uniform float uVideoOn; uniform vec2 uVideoSize;
      uniform vec4 uVideoRect; uniform vec4 uCursorRect; uniform vec3 uCursor;
      uniform float uWake; uniform float uGain; uniform float uRefl;
      float boxCov(vec2 p, vec4 r, vec2 fw) {
        vec2 lo = smoothstep(r.xy - fw * 0.5, r.xy + fw * 0.5, p);
        vec2 hi = 1.0 - smoothstep(r.zw - fw * 0.5, r.zw + fw * 0.5, p);
        return lo.x * lo.y * hi.x * hi.y;
      }
      void main() {
        vec2 fw = max(fwidth(vUv), vec2(1e-6));
        vec3 col = s2l(texture2D(uUI, vUv).rgb) * uWake * uGain;
        if (uVideoOn > 0.0) {
          vec2 vuv = (vUv - uVideoRect.xy) / (uVideoRect.zw - uVideoRect.xy);
          float inside = boxCov(vUv, uVideoRect, fw);
          // explicit LOD: exactly 0 at (or above) 1:1, so the nested frame is resampled without any
          // mip blending when the display fills the frame (the fixed point must not blur itself)
          vec2 tx = vuv * uVideoSize;
          float rho = max(length(dFdx(tx)), length(dFdy(tx)));
          float lod = max(0.0, log2(max(rho, 1e-6)) - 0.02);
          vec3 vid = s2l(textureLod(uVideo, vuv, lod).rgb);
          col = mix(col, vid, inside * uVideoOn);
        }
        col += uCursor * boxCov(vUv, uCursorRect, fw);
        col += uRefl * vec3(0.55, 0.62, 0.75) * (0.35 + 0.65 * smoothstep(0.0, 1.0, vUv.y)) * (1.0 - 0.5 * vUv.x);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const displayGeo = new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h);
  const display = new THREE.Mesh(displayGeo, displayMat);
  display.position.set(0, DISPLAY.yc, DISPLAY.z);
  lid.add(display);
  S.displayUniforms = displayUniforms;
  S.display = display;

  // mask quad (the pass-through region = the video rect on the display), drawn on its own
  const maskScene = new THREE.Scene();
  const maskMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  maskMesh.matrixAutoUpdate = false;
  maskScene.add(maskMesh);
  S.maskScene = maskScene; S.maskMesh = maskMesh;

  // screen light: an LTC rect light exactly over the display, facing out of it
  const rect = new THREE.RectAreaLight(0xffffff, 1, DISPLAY.w, DISPLAY.h);
  rect.position.set(SCREEN_C[0] + SCREEN_N[0] * 0.0006, SCREEN_C[1] + SCREEN_N[1] * 0.0006, SCREEN_C[2] + SCREEN_N[2] * 0.0006);
  rect.lookAt(SCREEN_C[0] + SCREEN_N[0], SCREEN_C[1] + SCREEN_N[1], SCREEN_C[2] + SCREEN_N[2]);
  scene.add(rect);
  S.screenLight = rect;

  // ---------------------------------------------------------------- room
  const deskTex = woodTexture(THREE, T);
  deskTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const deskMat = new THREE.MeshPhysicalMaterial({ map: deskTex, color: new THREE.Color(1.9, 1.75, 1.65), roughness: 0.38, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.28 });
  deskMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;
        float sdRB(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'RE_Direct_RectArea( rectAreaLight,', 'rectAreaLight.color *= 3.5; RE_Direct_RectArea( rectAreaLight,'))
      .replace('#include <opaque_fragment>', `
        float sd = sdRB(vWPos.xz, vec2(${(BASE.w / 2).toFixed(5)}, ${(BASE.d / 2).toFixed(5)}), ${BASE.planR.toFixed(5)});
        float occ = mix(0.08, 1.0, smoothstep(-0.002, 0.045, sd));
        occ *= mix(0.55, 1.0, smoothstep(0.0, 0.012, sd));
        outgoingLight *= occ;
        #include <opaque_fragment>`);
  };
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 1.5), deskMat);
  desk.position.set(0.1, -0.02, -0.2);
  scene.add(desk);

  const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.030, 0.032, 0.036), roughness: 0.95 });
  // A dim room needs a readable back wall (so every nested frame of the recursion has structure):
  // a soft warm pool from a lamp off to the right, cool spill under the window on the left.
  const wallUniforms = { uRoom: { value: 1 } };
  wallMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wallUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uRoom;')
      .replace('#include <opaque_fragment>', `
        vec2 q = vWPos.xy;
        float warmPool = exp(-pow(length((q - vec2(0.95, 0.42)) * vec2(0.9, 1.35)), 2.0) * 2.2);
        float coolPool = exp(-pow(length((q - vec2(-0.78, 0.1)) * vec2(1.0, 1.6)), 2.0) * 3.0);
        float floorFade = smoothstep(-0.02, 0.25, q.y);
        outgoingLight += (vec3(0.060, 0.034, 0.016) * warmPool + vec3(0.010, 0.015, 0.030) * coolPool) * floorFade * uRoom;
        #include <opaque_fragment>`);
  };
  S.wallUniforms = wallUniforms;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), wallMat);
  wall.position.set(0, 1.0, -0.95);
  scene.add(wall);

  // window: night sky + defocused city lights (pre-blurred bokeh, drawn in the shader)
  const winUniforms = { uAmt: { value: 1 } };
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8), new THREE.ShaderMaterial({
    uniforms: winUniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; uniform float uAmt;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 p = vUv;
        vec3 c = mix(vec3(0.016, 0.012, 0.012), vec3(0.002, 0.003, 0.008), smoothstep(0.0, 0.7, p.y));
        for (int i = 0; i < 70; i++) {
          float fi = float(i);
          vec2 q = vec2(h(vec2(fi, 1.3)), 0.04 + 0.30 * pow(h(vec2(fi, 7.1)), 1.8));
          float r = 0.012 + 0.022 * h(vec2(fi, 3.7));
          float d = length((p - q) * vec2(1.5625, 1.0));
          float disc = smoothstep(r, r * 0.8, d) * (0.8 + 0.2 * smoothstep(r * 0.5, r * 0.95, d));
          float warm = step(0.25, h(vec2(fi, 9.2)));
          vec3 lc = mix(vec3(0.5, 0.65, 1.0), vec3(1.0, 0.64, 0.3), warm);
          c += lc * disc * (0.02 + 0.05 * h(vec2(fi, 5.5)) * h(vec2(fi, 2.9)));
        }
        vec2 e = min(p, 1.0 - p) * vec2(1.25, 0.8);
        c *= smoothstep(0.0, 0.05, min(e.x, e.y));
        gl_FragColor = vec4(c * uAmt, 1.0);
      }`,
  }));
  win.position.set(-0.78, 0.62, -0.945);
  scene.add(win);
  S.winUniforms = winUniforms;

  // dim room lights: cool moonlight rim from the window side, a warm practical far right
  const moon = new THREE.DirectionalLight(new THREE.Color(0.55, 0.66, 1.0), 0.28);
  moon.position.set(-1.3, 0.32, -1.5);
  const warm = new THREE.DirectionalLight(new THREE.Color(1.0, 0.62, 0.32), 0.3);
  warm.position.set(1.8, 0.22, -0.9);
  const fill = new THREE.HemisphereLight(new THREE.Color(0.2, 0.24, 0.32), new THREE.Color(0.08, 0.05, 0.03), 0.03);
  scene.add(moon, warm, fill);
  S.room = { moon, warm, fill, moonI: 0.28, warmI: 0.3, fillI: 0.03 };
  // environment reflections, per material (scaled by the room light each frame)
  S.envMats = [[alu, 0.55], [blackGlass, 0.9], [keyMat, 0.25], [pad.material, 0.45], [padGap.material, 0.3], [hingeMat, 0.4],
    [deskMat, 0.04], [rubber, 0.2], [wallMat, 0.1], [well.material, 0.2]];
  for (const [m, k] of S.envMats) { m.envMap = S.envRT.texture; m.envMapIntensity = k; }
  S.well = well;

  Object.assign(S, { scene, laptop, lid, keys, desk, wall, win, alu });
  return S;
}

// -------------------------------------------------------------------- keycaps
function buildKeys(THREE, atlas) {
  const pos = [], nor = [], idxA = [], leg = [], index = [];
  const capH = 0.0022, top = BASE.h + KB.cap;
  for (const key of KEYS) {
    const r = keyRect(key);
    const g = roundedSlab(THREE, r.w, r.d, capH, 0.0017, 0.00055, { segC: 4, segE: 2 });
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), ix = g.getIndex();
    const base = pos.length / 3;
    const cell = atlas.cells[key.id];
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
      pos.push(r.x + lx, top - capH / 2 + ly, r.z + lz);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      idxA.push(key.id);
      leg.push((cell.x + (lx / r.w + 0.5) * cell.w) / atlas.W, (cell.y + (lz / r.d + 0.5) * cell.h) / atlas.H);
    }
    for (let i = 0; i < ix.count; i++) index.push(base + ix.getX(i));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('keyIdx', new THREE.Float32BufferAttribute(idxA, 1));
  geo.setAttribute('legendUv', new THREE.Float32BufferAttribute(leg, 2));
  geo.setIndex(index);
  return geo;
}

function legendAtlas(THREE, FONTS) {
  const W = 2048, H = 1024, PX = 8;              // px per mm
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const cells = [];
  let x = 6, y = 6, rowH = 0;
  for (const key of KEYS) {
    const r = keyRect(key);
    const w = r.w * 1000 * PX, h = r.d * 1000 * PX;
    if (x + w > W - 6) { x = 6; y += rowH + 8; rowH = 0; }
    cells[key.id] = { x, y, w, h };
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
    const mm = (v) => v * PX;
    if (key.arrow) {
      const cx = x + w / 2, cy = y + h / 2, s = mm(1.3);
      g.beginPath();
      if (key.arrow === 'l') { g.moveTo(cx - s, cy); g.lineTo(cx + s * 0.7, cy - s); g.lineTo(cx + s * 0.7, cy + s); }
      if (key.arrow === 'r') { g.moveTo(cx + s, cy); g.lineTo(cx - s * 0.7, cy - s); g.lineTo(cx - s * 0.7, cy + s); }
      if (key.arrow === 'u') { g.moveTo(cx, cy - s); g.lineTo(cx - s, cy + s * 0.7); g.lineTo(cx + s, cy + s * 0.7); }
      if (key.arrow === 'd') { g.moveTo(cx, cy + s); g.lineTo(cx - s, cy - s * 0.7); g.lineTo(cx + s, cy - s * 0.7); }
      g.fill();
    } else if (key.touchId) {
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = mm(0.3);
      g.beginPath(); g.arc(x + w / 2, y + h / 2, mm(3.2), 0, 6.3); g.stroke();
    } else if (key.small) {
      g.font = `500 ${mm(key.row < 0 ? 2.3 : 2.35)}px ${FONTS.sans}`;
      if (key.row < 0 && key.label !== 'esc') { g.textAlign = 'center'; g.fillText(key.label, x + w / 2, y + h - mm(1.9)); }
      else {
        g.textAlign = key.align === 'right' ? 'right' : 'left';
        g.fillText(key.label, key.align === 'right' ? x + w - mm(1.6) : x + mm(1.6), y + h - mm(1.6));
      }
    } else if (key.sub) {
      g.font = `400 ${mm(3.3)}px ${FONTS.sans}`; g.textAlign = 'center';
      g.fillText(key.sub, x + w / 2, y + mm(6.2));
      g.fillText(key.label, x + w / 2, y + mm(12.6));
    } else if (key.label) {
      g.font = `400 ${mm(4.4)}px ${FONTS.sans}`; g.textAlign = 'center';
      g.fillText(key.label, x + w / 2, y + h / 2 + mm(1.6));
    }
    g.restore();
    x += w + 8; rowH = Math.max(rowH, h);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { tex, cells, W, H };
}

function keyGlowTexture(THREE) {
  const W = 2048, H = Math.round(2048 * WELL.d / WELL.w);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const sx = W / WELL.w, sz = H / WELL.d;
  const x0 = WELL.x - WELL.w / 2, z0 = WELL.z - WELL.d / 2;
  // light leaking around every keycap: soft filled glow under each key (the caps hide the middle)
  g.filter = 'blur(5px)';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const key of KEYS) {
    const r = keyRect(key);
    const px = (r.x - r.w / 2 - x0) * sx, pz = (r.z - r.d / 2 - z0) * sz;
    g.beginPath();
    g.roundRect(px - 0.0011 * sx, pz - 0.0011 * sz, r.w * sx + 0.0022 * sx, r.d * sz + 0.0022 * sz, 0.0022 * sx);
    g.fill();
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function woodTexture(THREE, T) {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rnd = T.mulberry32(0xDE5C);
  g.fillStyle = '#2b1a10'; g.fillRect(0, 0, W, H);
  // broad colour bands
  for (let i = 0; i < 40; i++) {
    const y = rnd() * H, h = 20 + rnd() * 120;
    g.fillStyle = rnd() < 0.5 ? `rgba(70,42,24,${0.10 + rnd() * 0.18})` : `rgba(12,7,4,${0.12 + rnd() * 0.2})`;
    g.fillRect(0, y, W, h);
  }
  // grain lines: long, gently wavy strokes along x
  for (let i = 0; i < 900; i++) {
    const y = rnd() * H, amp = 2 + rnd() * 10, f = 0.002 + rnd() * 0.006, ph = rnd() * 6.28;
    const dark = rnd() < 0.62;
    g.strokeStyle = dark ? `rgba(10,5,2,${0.08 + rnd() * 0.22})` : `rgba(120,78,46,${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * (dark ? 2.6 : 1.6);
    g.beginPath();
    for (let x = -20; x <= W + 20; x += 16) {
      const yy = y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.3;
      if (x === -20) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // pores
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(6,3,1,${0.15 + rnd() * 0.3})`;
    g.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 9, 0.8 + rnd() * 0.9);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
