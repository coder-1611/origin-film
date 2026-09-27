// Reference chapter: copy this shape. A chapter is a plain object with init/render and
// optional post/drawUI. It must render ANY t inside T.chapterWindow(id) as a pure function
// of t (same t → same pixels, whatever was rendered before).
//
// This template draws a raymarched sphere in a fullscreen pass plus a Three.js mesh, just to
// show both styles. Delete what you don't need.

let pass, scene, camera, mesh;

export default {
  id: 'X',

  async init(ctx) {
    const { THREE, glsl, Pass } = ctx;
    pass = new Pass(glsl.all + /* glsl */`
      in vec2 vUv; out vec4 fragColor;
      uniform float t; uniform float aspect;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
        float d = length(p) - 0.5;
        vec3 col = vec3(0.02, 0.02, 0.05) + vec3(1.0, 0.8, 0.5) * 3.0 * exp(-40.0 * max(d, 0.0)) * step(0.0, 1.0);
        fragColor = vec4(col, 1.0);           // linear HDR
      }`, { t: { value: 0 }, aspect: { value: ctx.aspect } });

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, ctx.aspect, 0.01, 100);
    mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 4), new THREE.MeshStandardMaterial({ color: 0x8899ff, roughness: 0.4 }));
    scene.add(mesh, new THREE.DirectionalLight(0xffffff, 3));
  },

  // Linear HDR into `target` (half-float, W×H, with depth). Fully overwrite it.
  render(ctx, t, target) {
    const r = ctx.renderer;
    pass.render(r, target, { t });                        // background pass (clears by overwriting)
    ctx.applyCamera(camera, ctx.T.sampleCamera(ctx.T.cameras.I, t));
    mesh.rotation.y = t * 0.5;                            // motion = f(t), never f(frame count)
    r.autoClear = false;                                  // draw the mesh over the pass…
    r.setRenderTarget(target);
    r.clearDepth();
    r.render(scene, camera);
    r.autoClear = true;                                   // …and ALWAYS restore global state
  },

  // Optional post overrides (merged over DEFAULT_POST in src/engine/post.js).
  post(t) { return { bloom: 0.6, threshold: 1.0, grain: 0.035, vignette: 0.35 }; },

  // Optional typography in 1920×1080 design units; alpha = this chapter's blend weight.
  drawUI(g, t, alpha, ui) {},
};
