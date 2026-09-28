# Natural forms in WebGL: why AI-built nature looks fake, and what fixes it

Research and prototypes for ORIGIN chapter VI: the trees on the shore, and a new ~10 s
evolution-of-animals sequence ending with humans. Written 2026-09-27.

- **Lab modules:** `src/chapters/ch6/lab/`
- **Harness:** `src/chapters/ch6/lab/harness.js`, `tools/scratch/lab.html`, `tools/scratch/lab-snap.mjs`
- **Images and videos:** `tools/verify/out/lab/`

---

## 0. Verdict

| | Realistic | Silhouette | Decision |
|---|---|---|---|
| **Trees** | Works. Developmental space colonization, pipe-model radii, spur-leaf rosettes, crown-volume lighting and hierarchical wind read as real young trees at film distance. A hero costs ~2 ms/frame at 1080p (2× supersampled). | Not needed | **Realistic** |
| **Creatures** | Fails. Raymarched SDF anatomy reads as vinyl toys and wooden mannequins: sausage limbs, rubber tails, CG-perfect edges. It also costs 61–68 ms/frame. | Works. Seven instantly readable stages with fur, fins, glowing ears, a torch flame and wet-sand reflections, one continuous morphing outline. 4.6–8.4 ms/frame. | **Intricate silhouette** |

Why the split? Trees are made of thousands of small parts. Their realism comes from statistics
(branching, leaf angles, light falloff inside the crown), which a procedure can get right.
A creature is one large, continuous, *familiar* surface. The eye reads its anatomy, weight
and skin, and a capsule skeleton cannot supply those. The silhouette removes exactly what we
can't model (surface anatomy). It keeps what reads in 1.4 s per stage: outline, foot contact,
gait rhythm and backlight. Against a setting sun it is also the physically correct exposure;
a camera exposed for the sky records the subject as near-black with a rim.

---

## 1. The current chapter VI trees, diagnosed

Before: `tools/verify/out/lab/before-t121.jpg`, `before-t121-leaves-crop.jpg`, `before-t128.jpg`
(and the drafts at t = 115 and 118). The trees break almost every rule in §2:

| Tell | What the current build does |
|---|---|
| Leaves far too big (the "broccoli" look) | 13–18 cm flat cards in dense clusters at twig tips, each leaf a big visible diamond |
| L-system regularity | A ternary broadleaf rule: every node forks the same way, so bare trees look like umbrellas or fans |
| Poles for trunks | Archaeopteris stands read as telephone poles with horizontal sticks |
| One neon green | Yellow-green, uniformly lit, saturated |
| No crown volume | Leaves lit individually; no dark interior, no sunlit clumps |
| Clones | Two species, repeated, same silhouette |
| Growth as scaling | The whole tree scales up from 28 % (`SC0 = 0.28`) around its base |
| Flat quads | Single-quad leaves, no fold, no translucency gradient |

After: `tree-growth-100.png`, `tree-wide.png`, `tree-before-after.png`,
`tree-before-after-leaves.png`.

---

## 2. The tells of fake procedural nature, and the counters

Ranked by how much the eye notices each one. The "Lab" column shows where each fix lives.

| # | Tell | Why the eye notices | Fix (with numbers) | Lab |
|---|---|---|---|---|
| 1 | **Leaf angles all horizontal** | Seen from eye or water level, horizontal blades are edge-on, so the crown looks see-through and "twiggy". This was the biggest single improvement in the lab (`process/02` → `03`). | Near-spherical leaf-angle distribution (G ≈ 0.5); peripheral leaves turn their faces outward toward the light | `tree.js` `faceOut`, `leafOut = 1.1` |
| 2 | **Leaf scale wrong** | Big cards turn into cartoon clumps. Real leaves are ~1/100–1/200 of tree height (oak: 10–12 cm on a 20 m tree). | 7–11 cm blades on a 6 m tree: 18–37 k leaves, LAI ≈ 4 | `leafLen`, spur rosettes |
| 3 | **Regular branching** (deterministic L-systems, fixed angles, perfect 137.5°) | Repetition and self-similarity; ABoP itself calls it "artificial regularity". Measured divergence angles in mature trees are close to uniform. | Space colonization: branches compete for space, angles emerge (mean 38–51° per Stava); tropism, persistence and noisy crown lobes | `tree.js` |
| 4 | **No light falloff inside the crown** | Real crowns are dark inside and bright on sunlit clumps; per-leaf Lambert gives noise or flatness | Leaf-area-density volume: Beer–Lambert sun transmittance (σ = G·Ω ≈ 0.4 per LAD), 5-direction sky visibility, clump normals = −∇density, 55 % blend | `tree-render.js` |
| 5 | **Constant or cylinder thickness** | Real wood tapers continuously, flares at the root, and thickens at forks | Pipe model rⁿ = Σ r_childⁿ + leaves·a_leaf with n = 2.45 (measured Δ 1.8–2.5); root flare with 5 buttress lobes | `tree-render.js` update + `buildBark` |
| 6 | **One saturated green** | "Unmodulated chlorophyll green" (Gurney) | Linear albedo top (0.048, 0.090, 0.028) / underside (0.085, 0.120, 0.058); ±18 % value per leaf, small hue drift, sun and shade leaves, young leaves yellower | leaf FS |
| 7 | **No translucency** | Backlit leaves should glow and show dark veins | Diffuse transmission on the far side of the true blade normal; transmittance (0.070, 0.125, 0.018) ≈ 5–10 % in the green; veins 55 % darker in transmission | leaf FS + atlas G channel |
| 8 | **Flat, identical quads** | They read as paper | A 3×3-vertex blade folded 17–26° along the midrib, a tip droop and arch, 4 procedural blade shapes (serrate, entire, doubly serrate, cotyledon) | `leaf-atlas.js`, leaf VS |
| 9 | **Alpha-test shimmer, leaves vanishing at distance** | Mip averaging drops alpha under the cutoff; bright sky exposes aliasing | Golus: `a *= 1 + mip·0.25; a = (a − .5)/fwidth(a) + .5`; render at 2× (the chapter already uses SS = 2) | leaf FS |
| 10 | **Growth = uniform scaling** | Balloon inflation; old wood moves | Tip growth only (internodes extend once, then freeze), cambial thickening from the pipe model, laterals *unfurl* from their parent's axis, leaves unfold from folded buds | §3.3 |
| 11 | **Wind in phase or absent** | Synchronous motion is a classic CG tell | Trunk ~0.33 Hz scaled by height², limbs 0.45–3.2 Hz (f ∝ r/L²), leaves flutter 3–5 Hz; gust noise that travels along the wind; per-branch phase; hierarchical displacement | update() + leaf VS |
| 12 | **Bare wood hidden, or leaves on trunks** | Real trees show limb structure inside and carry leaves on current twigs | Leaves shed from wood whose subtree carries > 420 leaves: trunks and limbs go bare as they age | `limbLeaves` |
| 13 | **Clones** | The same silhouette repeated | Species presets (linden, maple, birch, oak) × seed × yaw × scale | `SPECIES` |
| 14 | **Not grounded** | Floating trees | Chapter shadow maps for the ground, root flare, sand bounce light | harness / chapter |
| 15 | **Black backlit stems** | A too-weak ground bounce leaves backlit wood pure black | Ground bounce = sand albedo × sun × sin(elevation) | `skyIrr` |

Creature tells, all confirmed in the lab's realistic mode:
- **Capsule or balloon anatomy** with no bony landmarks (see `creature-real-sidelit-*.png`).
- **Foot sliding.** Fixed here by construction: stance feet are locked to world anchors.
- **Pure-sine, mirrored timing.** Fixed by Hildebrand duty factors and phase offsets.
- **No weight.** Fixed by COM bob, heel-toe roll and head stabilisation.
- **CG-perfect edges.** Fixed in silhouette mode by fur-fringe breakup.
- **Uncanny valley.** Mori, and Seyama & Nagayama: an abnormal feature becomes unpleasant *only when realism is high*. The ape and the human are the risk.

### Lighting that sells realism cheaply

These all cost almost nothing:
- **Golden-hour backlight** makes translucency and the "silver lining" (the glow of optically thin crown edges; Bruneton & Neyret 2012) do the work.
- **Warm penumbrae.** Partial shadow is redder: `shadow^(1, 1.2, 1.5)` (Quilez).
- **Canopy multiple scattering.** Light scattered by leaves keeps the crown interior green-dark, not black. The lab uses leaf ω ≈ r + t tinted fill, weighted by (1 − T_sun).
- **Atmospheric perspective.** The chapter's air pass already does it.
- **Depth of field.** Physically consistent only, or landscapes read as tilt-shift miniatures (Held et al. 2010).
- **The hotspot.** For views away from the sun, forests brighten ~25 % within ~3° of the antisolar point (Bruneton, a₁ = 0.2, a₂ = 20). Not needed in these backlit shots.
- **Silhouettes hide surface detail, not outline detail.** A coarse outline shows as polygonal (Sander et al.), and a bright sky maximises edge aliasing. Spend detail and AA on the outline.

---

## 3. Trees: what was built and the parameters that worked

### 3.1 Structure (`tree.js`, `growTree`)

This is a developmental space-colonization algorithm (Runions, Lane & Prusinkiewicz 2007) with
an **expanding envelope**: attraction points are sampled in the volume swept by the crown envelope
scaled about the root. Point *q* becomes active when the envelope scale s(iteration) ≥ ρ(q). One
run therefore yields the finished tree *and* its growth history. Every node knows its birth
iteration, so growth needs no second simulation. Additions to the plain algorithm:

- **Apical dominance.** The leader climbs toward the envelope top every iteration while below
  `leaderStop·height`, then competes like any shoot. Values: linden 0.6, maple 0.55, oak 0.5, birch 0.9.
  Without this, space colonization grows a crown with no trunk; with it at 1.0 you get a telephone pole.
- **Direction.** `normalize(Σ unit vectors to points) + 0.45·previous direction + 0.16·up + 0.10·noise`,
  capped at 3 children per node, with duplicate shoots rejected (dot > 0.9) and balanced pulls skipped.
- **Envelope.** Profile `sin(π·u^a)^flat`, widest at `widest`, with azimuth×height lobe noise of ±30 %
  (tabulated for speed). Clumped point density (`clump = 0.55`) gives the sky holes.
- **Smoothing.** Three passes pulling each node halfway to the mean of its parent and main child
  (the Runions relocation idea), which removes the zig-zag.
- **Parameters** (6 m tree): 5 200 points, D = 8.5 cm, d_i = 0.95 m (≈11 D), d_k = 0.21 m (≈2.5 D),
  230 envelope iterations, s₀ = 0.03, sPow = 1.35 (a slow seedling phase), births mapped into g ∈ [0, 0.9].
- **Species presets.** `linden` (ovoid), `maple` (round, decurrent), `birch` (narrow, drooping
  twigs, 4.5–7 cm leaves, white bark), `oak` (broad, lobed, clumpy, gnarly).

Result for a 6 m linden: ~3.7 k nodes, ~565 chains, 27.6 k leaves, ~200 ms init.

### 3.2 Leaves

- **Placement.** 1–3 leaves per node in 137.5° phyllotaxis, plus a **spur rosette** of 4–8 leaves
  on 92 % of twig nodes. Short shoots are how most leaves sit on real older wood, and they give
  the crown its clumps.
- **Orientation.** Blades spread outward and droop at the tip. Normals lean up and outward from
  the crown centre (`leafOut 1.1`) with ±0.45 random tilt. See tell #1.
- **Shedding.** Leaves are shed from limbs (subtree > 420 leaves), so trunks and main limbs are bare.
- **Cotyledons.** Two round seed leaves on the first node, shed by g ≈ 0.3.
- **Atlas** (`leaf-atlas.js`). CPU-drawn once, 4 blades of 128×256 each, 3×3 supersampled coverage.
  Channels: R albedo mottling (veins lighter in reflection), G vein mask (darker in
  transmission), B distance to the margin (paler edges), A coverage.

### 3.3 Growth: a pure function of g ∈ [0, 1]

**CPU per frame** (`update(g, t, renderer)`):
1. **Chain unfurl quaternions.** A new lateral starts at 18 % of its final angle from its parent
   axis and opens over Δg = 0.06, composed down the hierarchy (Pirk et al. 2012; SpeedTree "unfurl").
2. **Forward pass.** Tip extension e = clamp((g − birth)/Δg_iter), rotated rest offsets, plus
   hierarchical wind.
3. **Reverse pass.** Pipe-model radii rⁿ = Σ r_childⁿ + (leaves born here)·(1.25 mm)ⁿ, with
   n = 2.45 and r_min = 2.3 mm. Radii never shrink: shed leaves keep their "disused pipes".
4. **Node texture.** Two texels per node: (position, radius) and (quaternion).
5. **Leaf-density splat** (only when g changes): trilinear splat of live leaf area into a 12 cm
   voxel grid, a 1-2-1 blur, then uploaded as an 8-bit 3D texture (0.06 m²/m³ per step).
6. **Node-light pass** (GPU, one tiny draw): per node, sun transmittance (12-step march over
   3.2 m), sky visibility (5 directions) and clump normal. Leaves and bark fetch their host node's
   values. Measured: the six-tree grove went from +21.8 ms (33.8 vs 12.0) to +14.4 ms (27.4 vs 13.0). With the allocation-free blur and background-tree splat stride, it ends at +11.8 ms.

**GPU skinning:**
- Bark is one continuous generalized-cylinder mesh per chain, with parallel-transport frames and
  16/11/7/5 sides by radius. Unborn rings collapse onto their node; they never go off-screen (see §7).
- Leaves are instanced. Each leaf is born `budDelay` = 0.004 after its node, starts as a folded
  bud hugging the shoot, turns out and opens over `unfold` = 0.05 (×0.3 for the seedling's first
  leaves), and matures from young yellow-green to its own green over ~5× that.

**Timing that reads as natural:**
- The first ~5 % is a seedling (cotyledons, then true leaves).
- The leader never runs more than ~1 m ahead of unfolded leaves.
- The grove staggers in (delays 0.1–0.36).

The builder should drive g from the score: a monotone g(t) that steps (eased) on each
`T.leafFlushes` note, so every marimba note visibly flushes new leaves at the tips.

### 3.4 Shading summary

- **Leaf.**
  - Two-sided: glossy upper face (GGX α² = 0.09), matte underside.
  - Diffuse uses the leaf normal blended 55 % toward the clump normal.
  - Transmission uses the true blade normal, with a forward lobe `pow(dot(−V, L), 8)`.
  - Sky fill uses sky visibility; canopy fill uses (1 − T_sun); sun term uses the warm penumbra.
- **Bark.**
  - Smooth young periderm with horizontal lenticels. Fissures only at the trunk base.
  - Shoot colour on current-year twigs; algae dust on the shaded side of old wood; birch variant.
  - The external shadow map is ignored for wood under 1–2 cm: shadow texels are larger than the twig and cause acne.

### 3.5 Cost

Measured at 1920×1080 on the M4. Every figure is a full lab frame: the chapter's own air view
at 2× supersampling, 2 shadow cascades and post, via `lab-snap.mjs --time 30`.

| Scene | ms/frame | JS ms | Tree cost |
|---|---|---|---|
| No trees (air view only) | 9.8 | 0.0 | — |
| Hero, 27.6 k leaves | 12.0 | 0.6 | **+2.2** |
| Hero growing | 11.4 | 0.9 | +1.6 |
| Grove of 6, ≈170 k leaves | 21.6 | 3.3 | **+11.8** |
| Grove growing (staggered) | 19.7 | 4.6 | +9.9 |
| Grove at SS = 1 | 16.1 vs 7.2 | 3.4 | +8.9 |

Init: 1.23 s for six trees. Determinism: `--determinism` printed IDENTICAL for all five
tree shots, and re-renders after a seek to another g and t are byte-identical.

---

## 4. Creatures: gait engine, two renderers, one morph

### 4.1 Skeleton and gait (`creatures.js`)

One generic builder, a spine of 16 samples plus 4 limbs plus head and extras, with a Tiktaalik
special case, emits round-cone primitives. Each primitive carries an anatomical **slot**
(`spine:7`, `LH:1`, `head:0`).

**Gait.**
- The body follows an analytic trajectory X(t), with optional surge for crutching and lunging.
- Each foot has a phase ψ = fract(t/T + offset).
- **Stance:** the foot is locked to a world anchor X(mid-stance) + hip. This makes foot sliding
  impossible by construction (fixes Troje's "feet carry the read").
- **Swing:** smoothstep travel and an early-peaking lift.
- Joints use analytic two-bone IK (Quilez). Digitigrade limbs add a metatarsal angle with heel
  lift; plantigrade feet pivot heel → ball → toe; the knuckle-walker plants the backs of its fingers.

| Stage | T (s) | Duty | Offsets (fraction of cycle) | v (m/s) | Secondary motion |
|---|---|---|---|---|---|
| Tiktaalik (2 m) | 1.40 | 0.50 | both pectorals 0 (crutching), pelvics 0.5 | 0.38, surge 0.85 | chest lifts on the push; head pitches up; tail sweeps |
| Salamander (0.2 m) | 0.70 | 0.69 | RH 0, RF .22, LH .5, LF .72 (lateral sequence) | 0.09 | standing-wave trunk, 12 mm |
| Lizard (0.45 m) | 0.47 | 0.60 | LH=RF 0, RH=LF .5 (walking trot) | 0.34 | travelling-wave bend, tail lag; tongue flick |
| Theropod (3 m, hip 1 m) | 0.93 | 0.60 | L 0, R .5 | 1.7 (Fr ≈ 0.3) | pelvis bob 3 cm twice per stride; head nod; tail yaw |
| Fox-sized mammal | 0.56 | 0.65 | LH 0, LF .25, RH .5, RF .75 | 1.2 | head nods twice per stride; ear flick; tail wave |
| Chimp | 0.70 | 0.65 | LH 0, RF .1, RH .5, LF .6 (diagonal sequence) | 1.05 | trunk inclined 30°; bent knees |
| Homo erectus (1.72 m) | 1.10 | 0.60 | L 0, R .5 | 1.27 | COM bob 4 cm p-p twice per stride; heel-off at 55 % stance; toe-off pitch 38°; free arm ±0.36 rad opposite its leg; torch arm held |

Periods follow T ≈ 2.3·√(L/g)·Fr^−0.2 (Alexander). Offsets and duties come from Hildebrand,
Cartmill, Frolich & Biewener, Pace & Gibb, Pontzer and the human gait-cycle data (§9).

### 4.2 Intricate silhouette (`creature-render.js`, mode `'sil'`): the recommended look

- **Shape.** Exact 2D uneven capsules (Quilez) on the creature's plane, smooth-unioned. Pose JS
  cost is 0.02–0.05 ms; there are 47–87 primitives per stage.
- **Transmission along the view ray.** For each limb, the chord through it is
  2√(r² − (r + d)²) in real millimetres. The transmitted light is sky × exp(−σ·chord) with
  σ = (0.55, 2.1, 3.6)/mm, so haemoglobin passes red. Every edge gets a physically thin red
  halo. Thin parts glow: ears at 4.5 mm, fin webs 9 mm, toes and whiskers.
- **Fur.** Edge strands are anisotropic noise, fine along the contour and long across it, sized in
  world units so drafts match finals. Hair tips scatter golden, not red: keratin, not blood.
- **Rim.** The radiance of the sky just behind the edge, strongest on edges facing the sun.
- **Far-side limbs** are lifted 7 % toward the sky so crossing legs keep their negative space.
- **Eye holes.** Reiniger-style see-through eyes were tried and removed: they read as glowing
  demon eyes. Mouth slits stay on the reptiles.
- **Torch.** A flickering blackbody flame (fbm teardrop) lights the edges that face it.
- **Ground.** Wet sand mirrors the sunset and the creature, with ripple-distorted reflection.
  A long soft shadow runs toward the camera, and the sea lies beyond.
- **Cost.** 4.6–8.4 ms per 1080p full frame; 5.7 ms mid-morph.

### 4.3 Realistic (`mode 'real'`): the honest comparison

This is a bounded 3D SDF raymarch using the same primitives: IQ round cones, smooth union,
per-primitive bound culling, and a tetrahedral normal made NaN-safe. Shading is two-tone skin
with scale or wrinkle bump, a wrap-lit sun, marched thickness translucency, a sky fill, SDF AO,
a Fresnel rim and a fur fuzz term.

Against the sunset (`creature-real-*.png`) it is mostly dark anyway, and where it isn't, it
looks smooth and plastic. Side-lit (`creature-real-sidelit-*.png`), the fox is a vinyl toy with a
sausage tail, the human a wooden artist's mannequin, and the ape a rubber figure. That is exactly
the fake look the owner described. It costs 61–68 ms/frame, 8–10× the silhouette.

Closing the gap would need sculpted anatomy (muscle and bone landmarks), a fur system and skin
shading. That is a different project, and it still lands the ape and the human in the uncanny valley.

### 4.4 The 10 s evolution walk (`evolution.js`)

**Staging.** Seven stages of 1.43 s each, as one continuously walking figure (Carl Sagan's
*Cosmos*, 1980, episode 2: "a single, unbroken outline"). The camera tracks it and the ground scrolls.

**The morph** (`morphCreatures`) is geometric:
- Matching slots interpolate endpoints, radii and blend, so the lizard's body really lifts into
  the theropod and the ape's knuckle-walking arms rise into the human's torch arm.
- Outgoing-only parts thin away in the first 60 % of the 0.32 s morph; incoming-only parts grow
  in the last 60 %. The torch flame catches only after the torch has formed.

**What failed first** (see `process/04`, `process/05`):
- A plain SDF lerp between stages makes non-overlapping parts **vanish** mid-morph: two floating
  blobs between the lizard and the theropod.
- A mass-preserving SDF union produces double-exposure **chimeras**.

**Ending.** The torch flame is a natural bridge to chapter VII, which opens on the ember of the
first fire. The walk can end with the flame at frame centre as the sun sets, so the flame *is*
the ember.

**Caveat.** The March of Progress reads as a ladder, and Gould's critique applies. An optional
answer: let each outgoing form walk on into a hazier background layer instead of dissolving,
leaving a branching bush of lineages behind the walker.

---

## 5. API sketch for the chapter-VI builder

```js
import { growTree, SPECIES } from './ch6/lab/tree.js';
import { makeTree } from './ch6/lab/tree-render.js';
import { makeLeafAtlas } from './ch6/lab/leaf-atlas.js';
import { makeCreatureRenderer } from './ch6/lab/creature-render.js';
import { evolutionFrame, EVO } from './ch6/lab/evolution.js';
import { GL_SHADOW } from './ch6/shadow.js';
import { GL_UNIFORMS, GL_SKY } from './ch6/common.js';

// ---- init
const atlas = makeLeafAtlas();                                   // once, shared by all trees
const skel = growTree({ seed: 11, species: 'linden', height: 6 }); // ~200 ms, deterministic
const tree = makeTree(skel, { pos: [x, y, z], yaw: 0.4, scale: 1 }, G, {   // G = ch6 globals (shared uniforms)
  atlas,
  extShadowGLSL: GL_SHADOW + 'float extShadow(vec3 p, vec3 n) { return sunShadow(p, n); }',
  densStride: 1,                                                  // 3 for background trees
  wind: 1,
});
air.scene.add(tree.group);                                        // writes vec4(linear HDR, distance), as ch6's air view expects
shadow.scene.add(tree.barkDepth, tree.leafDepth);

const walk = makeCreatureRenderer({ mode: 'sil', skyGLSL: GL_UNIFORMS + GL_SKY, uniforms: G });

// ---- per frame (before shadow.render and air.render)
tree.update(gOf(t), t, renderer);                                 // CPU skeleton + density + node-light pass

// evolution walk, τ = t − walkStart ∈ [0, EVO.duration]
const f = evolutionFrame(τ, { size: 1 });                          // { A, scroll, flame, water, … }
walk.render(renderer, target, camAir, {
  A: f.A, t: τ, H: ctx.H * SS, flame: f.flame, scroll: f.scroll, waterFront: f.water,
  frame: { rot: Matrix3 /* local → world, e.g. yaw toward the sun */, origin: Vector3 /* on the shore */ },
  bg: aOut.texture,                                               // composite over ch6's own air-view image
});
```

Exports:
- `tree.js`: `growTree(opts)`, `SPECIES`, `TREE_DEFAULTS`
- `tree-render.js`: `makeTree(skel, placement, sharedUniforms, opts)` → `{ group, bark, leaves, barkDepth, leafDepth, update(g, t, renderer), uniforms, stats, bbox }`
- `leaf-atlas.js`: `makeLeafAtlas()`
- `creatures.js`: `poseCreature(key, t)`, `morphCreatures(A, B, w)`, `STAGES`, `ik2`
- `creature-render.js`: `makeCreatureRenderer({ mode, skyGLSL, uniforms })` → `render(renderer, target, cam, opts)`
- `evolution.js`: `evolutionAt(τ)`, `evolutionFrame(τ)`, `placeCreature(key, t, size)`, `EVO`, `LOOK`
- `rng.js`: `mulberry32` and friends

The lab modules depend only on `vendor/three.module.js` and each other. The harnesses
additionally import the engine (Post, Pass) and ch6's air view, sky and shadow, read-only.

Integration notes:
- **Uniforms.** Trees need `uT, uDusk, uSunDir, uSunCol, uSkyZen, uSkyHor, uSkyHor2, uCamPos`
  (all in ch6's `makeGlobals`). They add `uWind` and `uWindDir` if missing. A kick envelope can
  drive `uWind` for a gust on the beat.
- **Post while the walk is on screen.** ch6's sunset post (bloom 0.8) veils the silhouettes grey.
  The lab uses bloom 0.5, threshold 1.2.
- **Local frame.** The `frame` option is verified: rotating the walk 50° with the camera and sun
  leaves the creature identical (`process/08-local-frame-test.png`).
- **Far forest.** Not tested: ~150 far trees would need a reduced preset (≈1.5 k points, bigger
  leaves, `densStride` 4) or impostors. Budget roughly 1–2 ms per 20 k leaves at SS = 2.

---

## 6. Harness and how to reproduce

```bash
# trees (1080p, SS2); shots are JSON: g = growth, t = time (wind), cam 'ou' | 'wide', stagger, only, camPos/camTarget/fov
node tools/scratch/lab-snap.mjs --scene tree --w 1920 --h 1080 --ss 2 --time 30 --determinism \
  --shots '[{"name":"g100","g":1,"stagger":true}]' --out tools/verify/out/lab
# creatures: stage + mode, or evo τ; sunAz/sunEl, yaw/origin for frame tests
node tools/scratch/lab-snap.mjs --scene creatures --w 1920 --h 1080 --shots '[{"name":"h","stage":"human","mode":"sil"}]'
# videos
node tools/scratch/lab-snap.mjs --scene creatures --w 1280 --h 720 --shots '[]' --video evo.mp4 --key evo --from 0 --to 10 --fps 30 --base '{"mode":"sil"}'
node tools/scratch/lab-snap.mjs --scene tree --w 1280 --h 720 --ss 2 --shots '[]' --video grow.mp4 --key g --from 0 --to 1 --dur 6 --base '{"stagger":true,"t0":114}'
```

Determinism: every checked shot prints IDENTICAL. That covers the growing hero, the growing
grove, the full grove, every silhouette stage, a morph frame, an evolution sweep and the
realistic mode.

---

## 7. Lessons from the prototypes (the traps)

1. **Edge-on leaves.** The camera sits at water level. Horizontal blades vanish and the crown
   looks sparse, even at LAI 4.7.
2. **Bare tips at 100 %.** Leaves born after g = 1 never appear. End births at g = 0.9.
3. **Slivers.** Sending unborn vertices to clip-space (2,2,2) makes triangles to the last live
   ring streak toward the corner. Collapse vertices instead.
4. **Buds as sticks.** Folded leaves pointing sideways read as crossbars. Buds must hug the shoot.
5. **Black stems.** Backlit, thin, and with too little ground bounce.
6. **Shadow-map acne on twigs.** Shadow texels larger than the twig. Fade the map out below 1–2 cm.
7. **NaN fireflies.** A zero-length gradient in the SDF normal turned into bloom stars. Make every normalize safe.
8. **Pixel-sized detail.** Fur defined in pixels looks twice as coarse in 960 px drafts. Size it in world units.
9. **Fur glowing red.** Hair is keratin, so its backlight is golden; red is for blood-filled tissue.
10. **SDF-lerp morphs.** Non-overlapping parts vanish. Use a geometric slot morph.
11. **Per-vertex volume marching** is wasted work. Light per node, then fetch.

---

## 8. Known limitations and next steps

- **Trees.**
  - Branch junctions are sleeves, not welded collars (invisible at film distance).
  - Individual alpha-tested leaves rely on SS = 2 for anti-aliasing.
  - There is no volumetric shadowing *between* trees; the chapter's shadow map covers that.
  - No falling-leaf animation; there is shrink and yellowing only.
  - Leaf-flush events are not wired yet.
- **Creatures.**
  - Proportions were tuned by eye from published ratios, not IoU-matched to reference photographs.
    The `particle-shaper` workflow would be the next step for the human and the ape.
  - Tiktaalik could read more fish-like (a broader head, a clearer fin fan).
  - No footprints and no fin ripples in the water yet.
  - The realistic mode is kept only as the comparison; it is untuned for production.

---

## 9. Sources

Failure modes, foliage shading and lighting:
- Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants*, ch. 1 — https://algorithmicbotany.org/papers/abop/abop-ch1.pdf
- "Do trees have constant branch divergence angles?" (J. Theor. Biol. 2020) — https://researchportal.tuni.fi/en/publications/do-trees-have-constant-branch-divergence-angles/
- The Grove, golden angle — https://www.thegrove3d.com/research/the-golden-angle-in-trees/
- Stava et al. 2014, Inverse procedural modeling of trees — https://cs.purdue.edu/homes/bbenes/papers/Stava14CGF.pdf
- Eloy 2011, Leonardo's rule — https://arxiv.org/abs/1105.2591
- Minamino & Tateno 2014 — https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0093535
- Lehnebach et al. 2018, pipe model review — https://pmc.ncbi.nlm.nih.gov/articles/PMC5906905/
- Codrops / ez-tree — https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/ · https://github.com/dgreenheck/ez-tree
- 80.lv SpeedTree foliage breakdown — https://80.lv/articles/creating-a-mysterious-scene-with-lifelike-foliage-using-speedtree
- SpeedTree light / ambient docs — https://docs.unity3d.com/speedtree-modeler/manual/light-object-reference.html · https://docs.unity3d.com/speedtree-modeler/manual/ambient-lighting.html
- Horizon Zero Dawn vegetation (GDC 2018) — https://media.gdcvault.com/gdc2018/presentations/gilbert_sanders_between_tech_and.pdf
- *Plants in Action*, leaf absorption — https://rseco.org/content/112-light-absorption.html
- Habel et al. 2007, real-time translucency for leaves — https://www.cg.tuwien.ac.at/research/publications/2007/Habel_2007_RTT/Habel_2007_RTT-Preprint.pdf
- Sousa, GPU Gems 3 ch. 16 (Crysis vegetation) — https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis
- Zioma, GPU Gems 3 ch. 6 (procedural wind) — https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-6-gpu-generated-procedural-wind-animations-trees
- Barré-Brisebois, translucency — https://colinbarrebrisebois.com/2012/04/09/approximating-translucency-revisited-with-simplified-spherical-gaussian/
- Bruneton & Neyret 2012, real-time forests — https://hal.inria.fr/hal-00650120/document
- Gurney, "the green problem" — http://gurneyjourney.blogspot.com/2008/06/green-problem.html
- ColorChecker foliage patch — https://en.wikipedia.org/wiki/ColorChecker
- Castaño, alpha mipmaps — http://www.ludicon.com/castano/blog/articles/computing-alpha-mipmaps/
- Golus, anti-aliased alpha test — https://github.com/bgolus/Unity-AlphaToCoverage
- Wyman & McGuire, hashed alpha — https://cwyman.org/papers/i3d17_hashedAlpha.pdf
- Quilez, outdoor lighting / fog — https://iquilezles.org/articles/outdoorslighting/ · https://iquilezles.org/articles/fog/
- Held et al. 2010, blur and perceived size — https://history.siggraph.org/learning/using-blur-to-affect-perceived-distance-and-size-by-held-cooper-obrien-and-banks/
- Sander et al. 2000, silhouette clipping — https://hhoppe.com/proj/silclip/

Trees, growth and wind:
- Runions, Lane & Prusinkiewicz 2007, space colonization — https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf
- Palubicki et al. 2009, self-organizing tree models — https://algorithmicbotany.org/papers/selforg.sig2009.small.pdf
- Weber & Penn 1995 — https://courses.cs.duke.edu/cps124/fall01/resources/p119-weber.pdf
- Prusinkiewicz et al. 1993, animation of plant development — http://computableplant.ics.uci.edu/papers/1993/prusinkiewicz93animation.pdf
- Pirk et al. 2012, capturing and animating tree morphogenesis — https://d-nb.info/1115661000/34
- Demotes-Mainard et al. 2013, organ expansion timing — https://pmc.ncbi.nlm.nih.gov/articles/PMC3807087
- proctree.js — https://github.com/supereggbert/proctree.js · The Grove — https://www.thegrove3d.com/ · SpeedTree branch generator — https://docs9.speedtree.com/modeler/doku.php?id=branch_generator
- Karlik, blue oak LAI — https://www.fs.usda.gov/psw/publications/documents/psw_gtr184/psw_gtr184_061_Karlik.pdf
- Leaf vernation — https://torontobotanicalgarden.ca/blog/word-of-the-week/botanical-nerd-word-vernation/
- Jackson et al. 2019, tree sway frequency — https://royalsocietypublishing.org/doi/10.1098/rsif.2019.0116
- Foliage motion, leaf flutter — https://royalsocietypublishing.org/rsif/article/15/142/20180010/64935/Foliage-motion-under-wind-from-leaf-flutter-to
- Unreal Pivot Painter 2 — https://dev.epicgames.com/documentation/en-us/unreal-engine/pivot-painter-tool-2.0-in-unreal-engine
- Wang et al. 2008, rotation-minimizing frames — https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Computation-of-rotation-minimizing-frames.pdf

Creatures, gaits and silhouette:
- Quilez: smin, distance functions (2D/3D), bounding, normals, FBM-SDF, IK, raymarching notes — https://iquilezles.org/articles/smin/ · https://iquilezles.org/articles/distfunctions/ · https://iquilezles.org/articles/distfunctions2d/ · https://iquilezles.org/articles/sdfbounding/ · https://iquilezles.org/articles/normalsSDF/ · https://iquilezles.org/articles/fbmsdf/ · https://iquilezles.org/articles/simpleik/ · https://iquilezles.org/articles/raymarchingdf/
- Alexander 1976 (Nature) — https://www.nature.com/articles/261129a0 · Alexander & Jayes 1983 — https://zslpublications.onlinelibrary.wiley.com/doi/10.1111/j.1469-7998.1983.tb04266.x
- Hildebrand gait parameters — https://en.wikipedia.org/wiki/Gait · Cartmill et al. 2002 — https://zenodo.org/records/5436906
- Hecker et al. 2008, Spore procedural animation — https://www.chrishecker.com/images/c/cb/Sporeanim-siggraph08.pdf
- Frolich & Biewener 1992, salamander — https://journals.biologists.com/jeb/article-abstract/162/1/107/6039/ · Ijspeert et al. 2007 — https://faculty.washington.edu/minster/bio_inspired_robotics_2022/papers/Ijspeert_crespi_Ryczko_cabelguen_swimming_walking_salamander_science07.pdf · salamander gait model (Frontiers 2021) — https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/fnbot.2021.645731/full
- Ritter 1992, lizard lateral bending — https://journals.biologists.com/jeb/article/173/1/1/736/Lateral-Bending-During-Lizard-Locomotion
- Pace & Gibb 2009, mudskipper — https://journals.biologists.com/jeb/article/212/14/2279/18314/ · McInroe et al. 2016 — https://www.science.org/doi/10.1126/science.aaf0984 · Shubin et al. 2006 — https://www.nature.com/articles/nature04637
- Pontzer et al. 2014, chimp locomotion — https://www.sciencedirect.com/science/article/pii/S0047248413002273 · Demes et al. 2014 — https://www.umass.edu/locomotion/pdfs/ajpa-2014.pdf
- Human gait cycle — https://en.wikipedia.org/wiki/Bipedal_gait_cycle · Persons & Currie 2011, theropod tails — https://anatomypubs.onlinelibrary.wiley.com/doi/10.1002/ar.21290
- Rosen, GDC 2014 (Overgrowth) — https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach · Little Polygon locomotion — https://blog.littlepolygon.com/posts/loco2/
- Proportions: Tiktaalik — https://en.wikipedia.org/wiki/Tiktaalik · Coelophysis — https://en.wikipedia.org/wiki/Coelophysis · limb proportions — https://efossils.org/book/limb-proportions · Turkana Boy — https://en.wikipedia.org/wiki/Turkana_Boy · Wonderwerk fire (Berna 2012) — https://www.pnas.org/doi/10.1073/pnas.1117620109
- Lotte Reiniger — https://en.wikipedia.org/wiki/Lotte_Reiniger · https://apollo-magazine.com/lotte-reiniger-silhouette-films/ · March of Progress — https://en.wikipedia.org/wiki/March_of_Progress · Cosmos ep. 2 — https://www.planetary.org/articles/20131021-cosmos-with-cosmos-episode-2-one-voice-in-the-cosmic-fugue
- TF2 illustrative rendering (NPAR 2007) — https://steamcdn-a.akamaihd.net/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf · Troje & Westhoff 2006 — https://pubmed.ncbi.nlm.nih.gov/16631591/
- Uncanny valley: Mori (trans. 2012) — https://www.researchgate.net/publication/254060168_The_Uncanny_Valley_From_the_Field · Seyama & Nagayama 2007 — https://direct.mit.edu/pvar/article/16/4/337/18670/ · MacDorman et al. 2009 — http://www.macdorman.com/kfm/writings/pubs/MacDorman2009TooRealForComfort.pdf
- Skin transmission: GPU Gems 3 ch. 14 — https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-14-advanced-techniques-realistic-real-time-skin · NIR window — https://en.wikipedia.org/wiki/Near-infrared_window_in_biological_tissue · Frostbite translucency — https://www.ea.com/frostbite/news/approximating-translucency-for-a-fast-cheap-and-convincing-subsurface-scattering-look

Caveats from the research:
- Some sources could only be read through abstracts or search summaries: Shadertoy, PubMed,
  ScienceDirect, and Ben Golus's Medium article (returned 403). Code was taken from his GitHub repo.
- The leaf-size-to-crown ratio is derived from oak numbers, not stated by any source.
- GPU Gems 3 ch. 6 is by Renaldas Zioma, and The Grove is by Wybren van Keulen (the brief
  attributed them otherwise).
