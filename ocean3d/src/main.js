// 딥 블루 3D — 바다 청소부 : main game module
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TAU, clamp, lerp, smooth, rnd, fmt, $, esc, seed, rr, rpick, wpick, SR } from './util.js';
import { TRASH, SPECIES, SPECIES_ORDER, UP, UP_ORDER, POIS, STORY } from './data.js';
import { AU, Music } from './audio.js';
import { MAT, initMaterials, buildSub, buildTrashGeos, fishGeo, lanternDotsGeo, BUILD, NET_GEO } from './models.js';
import { drawCockpit, cockpitLayout, CockpitUI } from './cockpit.js';
import { WORLD, heightAt, heightAt0, normalAt, reefPoint, reefFree, U, SEABED, buildTerrain, buildWater, buildSky, buildSnow, buildRays, buildFlora, buildSetPieces, buildBleach, buildBaseShip, buildDockRing, gradTex } from './world.js';

const V3 = THREE.Vector3, UPV = new V3(0, 1, 0), ZERO = new V3();
const OPV = new V3(), tv1 = new V3(), tv2 = new V3(), tv3 = new V3(), tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), ts = new V3(1, 1, 1);
const depthOf = (y) => Math.max(0, -y);
const SURF_Y = 0.8; // highest the sub can rise: surfaced, with the cockpit just above the water

// =====================================================================
// RENDERER / SCENE
// =====================================================================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x0b4f78, 0.01); scene.background = new THREE.Color(0x0b4f78);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 3400);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 0.9); composer.addPass(bloom);
composer.addPass(new OutputPass());
const hemi = new THREE.HemisphereLight(0x9fe3ff, 0x2a3a40, 1.2); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 2); sun.position.set(120, 300, 80); scene.add(sun); scene.add(sun.target);
const amb = new THREE.AmbientLight(0x3050a0, 0.06); scene.add(amb);
// glow sources (lures, jellies, vents, beacons) feed a few point lights; entries come from a pool so frames don't allocate
const glowPool = [];
const SPOT_K = Math.pow(16, 0.6 - 1); // keeps the lamp as bright as before at 16 m with the flatter falloff
function addGlow(p, col, k) { const n = G.glowSrc.length, s = glowPool[n] || (glowPool[n] = [new V3(), 0, 0]); s[0].copy(p); s[1] = col; s[2] = k; G.glowSrc.push(s); }
const glowLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffffff, 0, 22, 1.4); scene.add(l); return l; });
const overlay = $('overlay'), octx = overlay.getContext('2d');

// =====================================================================
// GAME STATE
// =====================================================================
const G = { vp: { x: 0, y: 0, w: innerWidth, h: innerHeight }, state: 'title', t: 0, dayT: 0.12, night: 0, sunH: 1, clean: 0, poll: 1, shake: 0, flash: 0, flashCol: '255,60,60', combo: 0, comboT: 0, sonar: null, sonarCd: 0, autosave: 0, tick: 0,
  alert: '', alertPri: 0, fullT: 0, creakT: 0, alarmT: 0, lowWarned: false, pendingWin: 0, quality: 2, qualityPref: 'auto', ctxLost: false, shakeOn: true, lastMTip: -99, sens: 1, fp: true, fpTier: -1, glowSrc: [], coralH: -1, bleachH: 0, bleachSet: -1, story: false, talk: false, VW: innerWidth, VH: innerHeight };
let SV = null; const S = {};
const DOCK = new V3(2.6, -8, -19);
const P = { pos: new V3(DOCK.x, DOCK.y - 3, DOCK.z - 15), vel: new V3(), yaw: Math.PI, pitch: -0.1, vyaw: Math.PI, vpitch: 0, roll: 0, bat: 100, hull: 100, kg: 0, cargo: [], beam: false, boost: false, thrust: 0, inv: 0, alive: true, deadT: 0, canDock: false, dmgT: 0, nose: new V3(), fwd: new V3(0, 0, -1) };
const fwdOf = (yaw, pitch, out = new V3()) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
const rightOf = (yaw, out = new V3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));
function freshSave() { return { v: 1, money: 0, up: { engine: 0, battery: 0, hull: 0, depth: 0, cargo: 0, light: 0, beam: 0, sonar: 0 }, mission: 0, mv: 3, sites: {}, valve: false,
  stats: { collected: 0, kg: 0, earned: 0, sells: 0, upgrades: 0, rescues: 0, deepest: 0, time: 0, dist: 0, types: {}, fails: 0 }, species: {}, pois: {}, tips: {}, won: false, dayT: 0.12 }; }
function calcStats() { const u = SV.up; S.speed = UP.engine.v[u.engine]; S.bat = UP.battery.v[u.battery]; S.hull = UP.hull.v[u.hull]; S.depth = UP.depth.v[u.depth]; S.cargo = UP.cargo.v[u.cargo];
  S.light = UP.light.v[u.light]; S.beam = UP.beam.v[u.beam]; S.beamPow = 7 + u.beam * 2.4; S.cut = 3.4 - u.beam * 0.4; S.sonar = UP.sonar.v[u.sonar]; S.sonarCd = 7.5 - u.sonar * 0.9;
  if (SUB) { SUB.spot.distance = S.light * 1.3; SUB.spot.angle = 0.5 + u.light * 0.04; } }
const ST = () => SV.stats;
const cleanPct = () => Math.floor(G.clean * 1000) / 10;
function recount() { let c = 0; for (const it of items) if (it.col) c++; G.clean = c / G.poll; }
POIS.forEach((p) => { if (p.y === undefined) p.y = heightAt(p.x, p.z) + 10; });
const POI = Object.fromEntries(POIS.map((p) => [p.id, p]));

// =====================================================================
// WORLD BUILD
// =====================================================================
initMaterials();
const colliders = [];
const terrain = buildTerrain(); scene.add(terrain);
const water = buildWater(); scene.add(water);
const sky = buildSky(); scene.add(sky);
const snow = buildSnow(); scene.add(snow);
const rays = buildRays(); scene.add(rays);
const flora = buildFlora(scene, colliders);
const pieces = buildSetPieces(scene, colliders);
const bleach = buildBleach(scene, colliders, flora); pieces.sites.bleach = bleach.site;
const ship = buildBaseShip(); scene.add(ship);
const dockRing = buildDockRing(); dockRing.position.copy(DOCK); scene.add(dockRing);
const CGRID = new Map(); const CG = 40;
for (const c of colliders) { const k = Math.floor(c.x / CG) + ',' + Math.floor(c.z / CG); if (!CGRID.has(k)) CGRID.set(k, []); CGRID.get(k).push(c); }
function nearColliders(x, z) { const out = []; const i0 = Math.floor(x / CG), j0 = Math.floor(z / CG); for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const l = CGRID.get(i + ',' + j); if (l) out.push(...l); } return out; }

// ---- submarine
const SUB = buildSub(); scene.add(SUB.root);
// decay 0.6, not 1: close surfaces no longer burn out to white
SUB.spot = new THREE.SpotLight(0xfff1dc, 90, 60, 0.5, 0.8, 0.6); SUB.spot.position.set(0, -0.35, 1.6); SUB.root.add(SUB.spot);
SUB.spotTarget = new THREE.Object3D(); SUB.spotTarget.position.set(0, -0.8, 20); SUB.root.add(SUB.spotTarget); SUB.spot.target = SUB.spotTarget;
SUB.fill = new THREE.PointLight(0xfff1d6, 9, 13, 1.4); SUB.fill.position.set(1.8, 3, -3.5); SUB.root.add(SUB.fill);
// volumetric headlight cone + tractor beam cone
const lightCone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uA: { value: 0.1 } },
  vertexShader: 'varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ vZ = position.z; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform float uA; varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = uA * (1.0 - smoothstep(0.0, 1.0, vZ)) * edge; gl_FragColor = vec4(vec3(1.0,0.95,0.82)*a, a); }' }));
lightCone.position.set(0, -0.35, 1.6); SUB.root.add(lightCone);
const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: U.time, uA: { value: 0 } },
  vertexShader: 'varying float vZ; varying vec2 vUv; void main(){ vZ = position.z; vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform float uTime; uniform float uA; varying float vZ; void main(){ float rings = 0.55 + 0.45*sin(vZ*28.0 + uTime*14.0); float a = uA*(1.0-vZ)*rings; gl_FragColor = vec4(vec3(0.35,1.0,0.9)*a, a); }' });
const beamCone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), beamMat); beamCone.visible = false; scene.add(beamCone);
const sonarMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uA: { value: 0 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(vec3(0.35,1.0,0.9)*f*uA, f*uA); }' }));
sonarMesh.visible = false; scene.add(sonarMesh);

// =====================================================================
// PARTICLES (GPU points, CPU simulated)
// =====================================================================
class FX {
  constructor(n, blending) {
    this.n = n; this.i = 0; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n); this.shape = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.type = new Uint8Array(n); this.base = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending, uniforms: { uScale: { value: 400 } },
      vertexShader: 'attribute vec4 aCol; attribute float aSize; attribute float aShape; uniform float uScale; varying vec4 vC; varying float vS; void main(){ vC = aCol; vS = aShape; vec4 mv = modelViewMatrix*vec4(position,1.0); vC.a *= smoothstep(0.8, 3.5, -mv.z); gl_PointSize = aSize*uScale/max(-mv.z,0.1); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; varying float vS; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = vS > 0.5 ? smoothstep(1.0,0.8,d)*smoothstep(0.45,0.7,d) + 0.25*smoothstep(0.5,0.0,length(gl_PointCoord-vec2(0.35))) : smoothstep(1.0,0.0,d); if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a*a); }' });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(type, x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, shape = 0) {
    const i = this.i; this.i = (i + 1) % this.n; this.type[i] = type; this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.life[i] = life; this.max[i] = life; this.size[i] = size; this.shape[i] = shape; this.base.set([r, g, b, a], i * 4); this.col.set([r, g, b, a], i * 4);
  }
  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.n; i++) { if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; } this.life[i] -= dt; const f = Math.max(0, this.life[i] / this.max[i]), k = i * 3, t = this.type[i];
      switch (t) {
        case 0: v[k + 1] = Math.min(v[k + 1] + 3.5 * dt, 5); v[k] += Math.sin(G.t * 6 + i) * 1.5 * dt; if (p[k + 1] > -0.4) this.life[i] = 0; break; // bubble
        case 1: v[k] *= 1 - 3 * dt; v[k + 1] *= 1 - 3 * dt; v[k + 2] *= 1 - 3 * dt; break; // spark
        case 2: v[k + 1] += 0.8 * dt; this.size[i] += 1.5 * dt; break; // smoke
        case 3: this.size[i] += 2.2 * dt; v[k] *= 1 - 2 * dt; v[k + 1] *= 1 - 2 * dt; v[k + 2] *= 1 - 2 * dt; break; // ink
        case 4: v[k + 1] -= 0.4 * dt; v[k] *= 1 - 1.5 * dt; v[k + 2] *= 1 - 1.5 * dt; v[k + 1] *= 1 - 1.5 * dt; break; // sand
        case 5: v[k + 1] = Math.min(v[k + 1] + 2 * dt, 3); break; // toxic
        case 6: v[k + 1] -= 18 * dt; if (p[k + 1] < 0 && v[k + 1] < 0) this.life[i] = 0; break; // splash
        case 7: this.size[i] += 12 * dt; break; // blip ring
      }
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      const b = i * 4; this.col[b] = this.base[b]; this.col[b + 1] = this.base[b + 1]; this.col[b + 2] = this.base[b + 2]; this.col[b + 3] = this.base[b + 3] * (t === 0 ? Math.min(1, f * 3) : f); }
    const g = this.pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aShape.needsUpdate = true;
  }
}
const FXA = new FX(1800, THREE.AdditiveBlending), FXN = new FX(2600, THREE.NormalBlending);
const PT = { BUB: 0, SPARK: 1, SMOKE: 2, INK: 3, SAND: 4, TOX: 5, SPLASH: 6, BLIP: 7 };
const bubble = (x, y, z, vx = 0, vy = 1, vz = 0, s = 0.12) => FXN.emit(PT.BUB, x, y, z, vx, vy, vz, rnd(2, 4), s, 0.85, 0.95, 1, 0.7, 1);
function burst(p, n, r, g, b, spd = 6, size = 0.25) { for (let i = 0; i < n; i++) { tv3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(spd * rnd(0.3, 1)); FXA.emit(PT.SPARK, p.x, p.y, p.z, tv3.x, tv3.y, tv3.z, rnd(0.4, 1), size, r, g, b, 1); } }
const ftexts = [];
function ftext(p, txt, col = '#e9c46a', size = 14) { ftexts.push({ p: p.clone(), txt, col, size, life: 1.6, max: 1.6 }); if (ftexts.length > 30) ftexts.shift(); }

// =====================================================================
// ITEMS (instanced per type)
// =====================================================================
const TGEO = buildTrashGeos();
const items = []; const IM = {};
const T_SURF = [['bag', 4], ['styro', 3], ['bottle', 4], ['cup', 2.5], ['mask', 1], ['rope', 0.6]];
const T_SHELF = [['bottle', 5], ['can', 4.5], ['bag', 3], ['mask', 3], ['glass', 3], ['cup', 3], ['rope', 1.5], ['tire', 0.6], ['styro', 1]];
const T_SLOPE = [['bottle', 3], ['can', 3], ['glass', 3], ['tire', 2], ['cart', 1.2], ['ewaste', 2], ['rope', 2], ['battery', 1.5], ['bag', 1.2]];
const T_PLAIN = [['tire', 2.5], ['cart', 1.5], ['ewaste', 2.5], ['drum', 1.6], ['scrap', 2.5], ['battery', 2], ['glass', 1.5], ['can', 1.2]];
const T_DEEP = [['drum', 3], ['scrap', 2.5], ['ewaste', 2], ['battery', 2], ['tire', 1]];
const T_MID = [['bag', 3], ['bottle', 2], ['mask', 1.5], ['cup', 1.5]];
const T_REEF = [['bag', 3], ['bottle', 3], ['can', 3], ['cup', 2], ['mask', 2], ['rope', 1.5], ['glass', 1], ['tire', 0.4]];
function addItem(type, x, y, z, o = {}) {
  const D = TRASH[type];
  const it = { id: items.length, type, key: type, pos: new V3(x, y, z), home: new V3(x, y, z), orig: new V3(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.5, 0.5), rr(0, TAU), rr(-0.5, 0.5))), r: D.r, kg: D.kg, v: D.v,
    buoy: o.buoy ?? -1, state: 0, vel: new V3(), col: false, known: false, rev: 0, leak: type === 'drum' && SR.r() < 0.6, locked: !!o.locked, ph: rr(0, TAU), spin: 0, idx: 0, dirty: true };
  if (type === 'container' || type === 'drum' || type === 'cart') it.q.setFromEuler(new THREE.Euler(rr(-0.15, 0.15), rr(0, TAU), rr(-0.15, 0.15)));
  items.push(it); return it;
}
function floorItem(type, x, z, o = {}) { const D = TRASH[type]; const y = heightAt(x, z) + D.r * 0.45; return addItem(type, x, y, z, o); }
function polar(cx, cz, r0, r1) { const a = rr(0, TAU), d = lerp(r0, r1, Math.sqrt(SR.r())); return [cx + Math.cos(a) * d, cz + Math.sin(a) * d]; }
function genItems() {
  seed(31337);
  const n = (cnt, fn) => { let k = 0, g = 0; while (k < cnt && g++ < cnt * 30) if (fn()) k++; };
  n(75, () => { const [x, z] = polar(0, 0, 18, 235); return floorItem(wpick(T_SHELF), x, z); });
  n(28, () => { const [x, z] = polar(0, 0, 30, 260); return addItem(wpick(T_SURF), x, -rr(1.6, 9), z, { buoy: 1 }); });
  n(72, () => { const [x, z] = polar(POI.patch.x, POI.patch.z, 0, 150); return addItem(wpick(T_SURF), x, -rr(1.5, 13), z, { buoy: 1 }); });
  n(5, () => { const [x, z] = polar(POI.patch.x, POI.patch.z, 0, 140); return addItem('net', x, -rr(2, 8), z, { buoy: 1 }); });
  n(85, () => { const [x, z] = polar(0, 0, 250, 440); if (heightAt0(x, z) < -330) return false; return floorItem(wpick(T_SLOPE), x, z); });
  n(22, () => { const [x, z] = polar(0, 0, 260, 560); const y = -rr(50, 200); if (y < heightAt0(x, z) + 15) return false; return addItem(wpick(T_MID), x, y, z, { buoy: 0 }); });
  n(85, () => { const [x, z] = polar(0, 0, 460, 700); const h = heightAt0(x, z); if (h < -380 || h > -200) return false; return floorItem(wpick(T_PLAIN), x, z); });
  n(3, () => { const [x, z] = polar(0, 0, 470, 640); const h = heightAt0(x, z); if (h < -380) return false; return floorItem('net', x, z); });
  n(14, () => { const [x, z] = polar(POI.wreck.x, POI.wreck.z, 8, 45); return floorItem(wpick([['scrap', 3], ['drum', 1.5], ['tire', 1], ['ewaste', 1], ['battery', 1]]), x, z); });
  n(8, () => { const [x, z] = polar(POI.plane.x, POI.plane.z, 5, 35); return floorItem(wpick([['scrap', 2], ['ewaste', 2], ['battery', 1], ['glass', 1]]), x, z); });
  n(24, () => { const x = rr(-860, -640), z = rr(-330, 330); if (heightAt0(x, z) > -600) return false; return floorItem(wpick(T_DEEP), x, z); });
  n(20, () => { const x = rr(650, 860), z = rr(-330, 330); if (heightAt0(x, z) > -450) return false; return floorItem(wpick(T_DEEP), x, z); });
  n(5, () => { const [x, z] = polar(POI.cship.x, POI.cship.z, 15, 60); return floorItem('container', x, z); });
  n(45, () => { const p = reefPoint(-70); return p && reefFree(p[0], p[2], 0.9) ? floorItem(wpick(T_REEF), p[0], p[2]) : false; }); // litter lying in the gaps between corals
}
// Cleanup sites: the wreck and the airliner hold their own debris, tracked so the HUD can show progress
// and the oil leak stops once a site is clean. Generated after the rescue nets so the ids of older items,
// which saves refer to, keep their meaning.
const SITES = [], SITE = {};
const T_DECK = [['crate', 3], ['vest', 2.5], ['rope', 1.5], ['drum', 0.8], ['bottle', 1]];
const T_WRECK = [['crate', 3], ['vest', 2.5], ['scrap', 1.2], ['rope', 1.5], ['bottle', 1.2], ['can', 1], ['battery', 0.5], ['tire', 0.5]];
const T_BDECK = [['bag', 4], ['rope', 1.5], ['mask', 1.5], ['cup', 1], ['net', 0.5]];
const T_BFLOOR = [['bottle', 3], ['can', 3], ['bag', 2], ['cup', 2], ['glass', 1.5], ['styro', 1], ['mask', 1]];
const T_PLANE = [['seat', 3], ['luggage', 3], ['panel', 1.6], ['ewaste', 1], ['bottle', 1], ['cup', 0.8], ['mask', 0.6]];
// older debris at the sites becomes cargo and cabin litter; re-typed by id (not the RNG) so later items keep their layout
const RETYPE = { wreck: { scrap: ['crate', 'vest', 'scrap'], tire: ['rope'], ewaste: ['bottle'], battery: ['vest'] }, plane: { scrap: ['panel'], ewaste: ['luggage', 'seat'], battery: ['seat'] } };
function retype(it, site) { const opts = RETYPE[site] && RETYPE[site][it.type]; if (!opts) return; const t = opts[it.id % opts.length], D = TRASH[t]; Object.assign(it, { type: t, key: t, r: D.r, kg: D.kg, v: D.v }); }
function unstick(it) { // push floor debris out of the hulls so the sub can reach it
  it.pos.y = heightAt(it.pos.x, it.pos.z) + it.r * 0.45;
  for (let k = 0; k < 8; k++) { let hit = false;
    for (const c of nearColliders(it.pos.x, it.pos.z)) { const dx = it.pos.x - c.x, dz = it.pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + it.r + 0.4;
      if (d < m && Math.abs(it.pos.y - c.y) < c.r + it.r) { if (d > 0.01) { it.pos.x += (dx / d) * (m - d); it.pos.z += (dz / d) * (m - d); } else it.pos.x += m; hit = true; } }
    if (!hit) break; it.pos.y = heightAt(it.pos.x, it.pos.z) + it.r * 0.45; }
  it.home.copy(it.pos); it.orig.copy(it.pos);
}
function genSiteItems() {
  seed(2718); const first = items.length; // ids from here on are the site's own debris
  const defs = { wreck: { n: '아틀란틱호', deck: T_DECK, floor: T_WRECK, ring: [8, 50], cnt: 12 }, plane: { n: '추락한 여객기', deck: T_PLANE, floor: T_PLANE, ring: [4, 36], cnt: 10 },
    bleach: { n: '하얀 산호 지대', deck: T_BDECK, floor: T_BFLOOR, ring: [3, 44], cnt: 14, top: 12, valve: true, tip: '하얀 산호 지대: 뜨거운 폐수와 쓰레기 때문에 산호가 하얗게 죽어 갑니다. 배출관 밸브를 잠그고 쓰레기를 치우세요.' } };
  for (const id in defs) { const D = defs[id], ps = pieces.sites[id]; const s = { id, n: D.n, c: ps.center.clone(), r: ps.r, leaks: ps.leaks, ids: [], total: 0, left: 0, top: D.top || 34, valve: !!D.valve, tip: D.tip || `${D.n}: 기름이 새고 있습니다. 주변 잔해를 모두 수거하면 유출이 멈춥니다.`, dir: ps.dir };
    s.depth = Math.ceil(-s.c.y) - 2; s.c.y += 6; SITES.push(s); SITE[id] = s;
    for (const p of ps.spots) { const t = wpick(D.deck); addItem(t, p.x, p.y + TRASH[t].r * 0.45, p.z).deck = true; }
    for (let k = 0; k < D.cnt; k++) { const [x, z] = polar(ps.center.x, ps.center.z, D.ring[0], D.ring[1]); floorItem(wpick(D.floor), x, z); } }
  for (const it of items) { if (it.locked) continue;
    for (const s of SITES) if (Math.hypot(it.pos.x - s.c.x, it.pos.z - s.c.z) < s.r && it.pos.y < s.c.y + s.top) { it.site = s.id; s.ids.push(it.id); if (it.id < first) retype(it, s.id); if (!it.deck) unstick(it); } }
  for (const s of SITES) s.total = s.left = s.ids.length;
}
// silent: sync the done flags after a load without toasts
function siteTick(silent) {
  for (const s of SITES) { let left = 0; for (const id of s.ids) if (!items[id].col) left++; s.left = left;
    if (!left && (!s.valve || SV.valve) && !SV.sites[s.id]) { SV.sites[s.id] = 1; if (!silent) { toast(`${s.n} 정화 완료`, 'big', s.valve ? '오염원이 사라지자 산호가 다시 색을 되찾고, 물고기들이 돌아옵니다.' : '기름 유출이 멈췄습니다. 깨끗해진 잔해에 물고기들이 모여듭니다.'); AU.mission(); saveGame(); } } }
}
function updateSites(dt) {
  for (const s of SITES) { const d = Math.hypot(P.pos.x - s.c.x, P.pos.z - s.c.z);
    if (d < s.r + 30 && G.state === 'play') tip('site_' + s.id, s.tip);
    if (s.valve) { if (!SV.valve && camera.position.distanceToSquared(s.c) < 200 * 200) for (const L of s.leaks) { // hot, cloudy wastewater drifting over the reef
      if (Math.random() < dt * 10) FXN.emit(PT.SMOKE, L.x + rnd(-0.4, 0.4), L.y + rnd(-0.3, 0.3), L.z + rnd(-0.4, 0.4), s.dir.x * rnd(1.5, 3) + rnd(-0.3, 0.3), rnd(0.1, 0.5), s.dir.z * rnd(1.5, 3) + rnd(-0.3, 0.3), rnd(6, 10), rnd(0.8, 1.6), 0.3, 0.27, 0.19, 0.4);
      if (Math.random() < dt * 6) bubble(L.x + rnd(-0.5, 0.5), L.y + 0.4, L.z + rnd(-0.5, 0.5), rnd(-0.2, 0.2), rnd(0.8, 1.6), rnd(-0.2, 0.2), rnd(0.08, 0.16)); }
      continue; }
    if (SV.sites[s.id] || camera.position.distanceToSquared(s.c) > 230 * 230) continue;
    for (const L of s.leaks) if (Math.random() < dt * 5) { const o = Math.random() < 0.3; FXN.emit(PT.SMOKE, L.x + rnd(-0.5, 0.5), L.y, L.z + rnd(-0.5, 0.5), rnd(-0.25, 0.25), rnd(0.4, 0.9), rnd(-0.25, 0.25), rnd(6, 9), rnd(0.4, 1), o ? 0.022 : 0.007, o ? 0.015 : 0.007, o ? 0.006 : 0.008, 0.85); } }
}
// the bleached reef's outfall valve: hold the tractor beam on the wheel to close it
function updateValve(dt) {
  const v = bleach.valve; if (SV.valve) return;
  if (G.state === 'play' && P.pos.distanceTo(v.pos) < 30) tip('valve', '폐수 배출관 밸브입니다. 트랙터 빔을 계속 비추면 밸브가 잠깁니다.');
  let on = false; if (P.beam && G.state === 'play') { tv1.subVectors(v.pos, P.nose); const ed = tv1.length(); on = ed < 3.5 || (ed < S.beam + 3 && tv1.dot(P.fwd) / ed > Math.cos(0.5 + aimPad())); }
  v.prog = on ? v.prog + dt / 3 : Math.max(0, v.prog - dt * 0.15); v.wheel.rotation.y = v.prog * TAU * 2;
  if (on) { if (Math.random() < dt * 20) FXA.emit(PT.SPARK, v.pos.x + rnd(-0.6, 0.6), v.pos.y + rnd(-0.1, 0.2), v.pos.z + rnd(-0.6, 0.6), rnd(-2, 2), rnd(0, 3), rnd(-2, 2), 0.35, 0.15, 1, 0.9, 0.55, 1); if (Math.random() < dt * 6) AU.cut(); setAlert(`밸브 잠그는 중 ${Math.min(100, Math.round(v.prog * 100))}%`, 1); }
  if (v.prog >= 1) { SV.valve = true; toast('폐수 배출관 차단', 'big', '뜨거운 폐수가 멈췄습니다. 이제 산호를 덮은 쓰레기를 치우면 색이 돌아옵니다.'); AU.mission(); saveGame(); }
}
// bleached (0) to recovered (1): closing the valve lets the corals start to recover, each piece of litter cleared brings back more colour
function bleachTarget() { const s = SITE.bleach; if (G.story) return SS.coralDone ? 1 : SV.valve ? Math.min(0.9, 0.2 + 0.14 * storyCoral()) : 0; if (SV.sites.bleach) return 1; const f = 1 - s.left / s.total; return SV.valve ? 0.15 + 0.5 * f : 0.05 * f; }
function updateBleach(dt, snap) { const t = bleachTarget(); G.bleachH = snap ? t : G.bleachH + (t - G.bleachH) * Math.min(1, dt * (G.story ? 0.6 : 0.3)); if (snap || Math.abs(G.bleachH - G.bleachSet) > 0.01) { G.bleachSet = G.bleachH; bleach.set(G.bleachH); } }
const rescues = [];
function genRescues() {
  seed(5150);
  const defs = [['turtle', -120, 40, 3], ['turtle', 180, -60, 3], ['dolphin', -320, -150, -40], ['turtle', 300, 250, 3], ['turtle', 330, -600, -3], ['manta', -480, 200, 6], ['shark', 390, -350, 5], ['dolphin', 100, -380, -30]];
  defs.forEach(([sp, x, z, dy], i) => { const y = dy > 0 ? heightAt(x, z) + dy + 1 : Math.max(dy, heightAt(x, z) + 8);
    const net = addItem('net', x, y, z, { buoy: dy > 0 ? -1 : 0, locked: true });
    const b = BUILD[sp](); const sc = { turtle: 1.3, dolphin: 1.2, manta: 0.7, shark: 0.8 }[sp]; b.root.scale.setScalar(sc); b.root.position.set(x, y, z); b.root.rotation.y = rr(0, TAU); scene.add(b.root);
    const nm = new THREE.Mesh(NET_GEO(), new THREE.MeshStandardMaterial({ color: 0x6fc4b4, wireframe: true, emissive: 0x0a2a24 })); nm.scale.set(2.4 * sc * (sp === 'manta' ? 2.5 : 1), 1.6 * sc, 2.6 * sc * (sp === 'shark' ? 1.4 : 1)); nm.position.set(x, y, z); scene.add(nm);
    rescues.push({ id: i, sp, pos: new V3(x, y, z), prog: 0, freed: false, t: rr(0, 10), net: net.id, known: false, model: b, netMesh: nm, cutting: false }); });
}
function buildItemMeshes() {
  const counts = {}; for (const it of items) counts[it.key] = (counts[it.key] || 0) + 1;
  for (const key in counts) { const geo = TGEO[key]; const mat = key === 'bag' ? MAT.bag : key === 'panel' ? MAT.vcD : key === 'net' ? new THREE.MeshStandardMaterial({ color: 0x5fb8a8, wireframe: true, emissive: 0x0a2a24 }) : MAT.vc;
    const im = new THREE.InstancedMesh(geo, mat, counts[key]); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); IM[key] = { im, n: 0 }; }
  const cols = ['#b8392b', '#2d6fb0', '#2e8b57'], bags = ['#c0392b', '#1f3a68', '#b8bec6', '#e0a526', '#2c7a4b', '#6b3fa0'];
  for (const it of items) { const r = IM[it.key]; it.idx = r.n++; if (it.type === 'container') r.im.setColorAt(it.idx, new THREE.Color(cols[it.id % 3])); if (it.type === 'luggage') r.im.setColorAt(it.idx, new THREE.Color(bags[it.id % bags.length])); }
  for (const it of items) writeItem(it);
}
function writeItem(it, bob = 0) {
  const r = IM[it.key]; if (it.col || it.locked) { tm.makeScale(0, 0, 0); r.im.setMatrixAt(it.idx, tm); r.im.instanceMatrix.needsUpdate = true; return; }
  tv1.copy(it.pos); let q = it.q;
  if (bob) { tv1.y += Math.sin(G.t * 1.2 + it.ph) * 0.3 * bob; tq.setFromEuler(new THREE.Euler(Math.sin(G.t * 0.7 + it.ph) * 0.3, G.t * 0.1 + it.ph, 0)).premultiply(it.q); q = tq; }
  if (it.spin) { tq.setFromAxisAngle(UPV, it.spin).multiply(it.q); q = tq; }
  tm.compose(tv1, q, ts.set(1, 1, 1)); r.im.setMatrixAt(it.idx, tm); r.im.instanceMatrix.needsUpdate = true;
}

// =====================================================================
// CREATURES
// =====================================================================
const creatures = [], schools = [];
const CDEF = { clownfish: { r: 0.3, spd: 2 }, tang: { r: 0.4, spd: 3 }, turtle: { r: 1.2, spd: 3 }, seahorse: { r: 0.4, spd: 0.6 }, crab: { r: 0.4, spd: 1.2 }, jelly: { r: 0.9, spd: 0.6 }, manta: { r: 2.5, spd: 4 },
  dolphin: { r: 1.3, spd: 9 }, shark: { r: 1.8, spd: 6.5 }, whale: { r: 6, spd: 3 }, octopus: { r: 0.8, spd: 1 }, angler: { r: 0.8, spd: 1 }, dumbo: { r: 0.6, spd: 1.2 }, squid: { r: 3, spd: 3 } };
const SMALL = { clownfish: 1, tang: 1 };
const FISH_KINDS = ['sardine', 'lantern', 'clownfish', 'tang', 'reef', 'butter', 'angel', 'parrot', 'idol', 'barra', 'snapper', 'grouper', 'puffer', 'hagfish', 'shrimp'];
const FISHIM = {};
function Z(cx, cz, rad, y0, y1) { return { cx, cz, rad, y0, y1 }; }
function zonePoint(z, r = 1, out = new V3()) { for (let k = 0; k < 20; k++) { const a = rr(0, TAU), d = Math.sqrt(SR.r()) * z.rad, x = z.cx + Math.cos(a) * d, zz = z.cz + Math.sin(a) * d; const fl = heightAt(x, zz) + r + 1.5; const lo = Math.max(fl, z.y0), hi = Math.min(-r - 0.8, z.y1); if (hi > lo) return out.set(x, rr(lo, hi), zz); } return out.set(z.cx, Math.max(heightAt(z.cx, z.cz) + r + 2, z.y0), z.cz); }
function addC(sp, z, o = {}) {
  const at = o.at ? o.at.clone() : zonePoint(z, CDEF[sp].r);
  const e = { sp, pos: at, vel: new V3(), z, t: rr(0, 100), ph: rr(0, TAU), tgt: at.clone(), home: at.clone(), timer: 0, need: o.need || 0, a: 0, state: 0, cd: rr(0, 5), r: CDEF[sp].r, spd: CDEF[sp].spd * rr(0.85, 1.15), hue: rr(0, 360), id: creatures.length, q: new THREE.Quaternion(), walk: 0, ...(o.extra || {}) };
  if (!SMALL[sp]) { const b = BUILD[sp](e); e.model = b; e.root = b.root; e.root.position.copy(e.pos); e.root.scale.setScalar(0.001); e.root.visible = false; scene.add(e.root); }
  creatures.push(e); return e;
}
function addSchool(sp, z, n, extra, o = {}) { const c = zonePoint(z, 3); const s = { sp, z, pos: c.clone(), vel: new V3(), tgt: c.clone(), timer: 0, m: [], rad: o.rad || (sp === 'sardine' ? 5 : 4.5), hug: o.hug, col: o.col, scale: o.scale || 1, spd: o.spd, amb: o.amb, site: o.site };
  if (s.hug) { c.y = heightAt(c.x, c.z) + rr(s.hug[0], s.hug[1]); s.pos.copy(c); s.tgt.copy(c); }
  for (let i = 0; i < n + extra; i++) { const o = new V3(rr(-1, 1), rr(-0.5, 0.5), rr(-1, 1)).multiplyScalar(s.rad); s.m.push({ o, pos: c.clone().add(o), vel: new V3(), need: i < n ? 0 : rr(0.08, 0.85), a: 0 }); }
  schools.push(s); }
function genCreatures() {
  seed(8080);
  [[-150, -20, 120, -30, -4], [150, 0, 120, -30, -4], [0, 180, 150, -40, -5], [60, -240, 140, -50, -5], [-260, 180, 140, -60, -6], [330, -600, 120, -20, -3],
    [120, 60, 90, -25, -4], [-40, 260, 130, -45, -5], [240, -160, 130, -45, -5], [-300, -120, 140, -55, -6], [220, 220, 120, -35, -4]].forEach((z, i) => addSchool('sardine', Z(...z), i < 3 || i > 5 ? 34 : 22, 26));
  [[-520, 250, 150, -340, -170], [470, -330, 150, -340, -170], [-380, -300, 150, -320, -170], [380, 330, 150, -320, -170], [0, -480, 150, -330, -170], [-600, -520, 150, -340, -180]].forEach((z) => addSchool('lantern', Z(...z), 22, 16));
  // small colourful reef fish that hug the coral heads (ambient: not a codex species)
  const REEFC = ['#ffd23f', '#3fa7ff', '#ff7b54', '#9b5de5', '#c5e063', '#ff5d8f', '#00f5d4', '#f15bb5'];
  [[150, 20, 70], [120, -60, 60], [200, 90, 60], [60, 200, 60], [90, -200, 60], [230, 210, 50], [-180, 200, 50], [-20, 80, 40], [180, -20, 50], [100, 120, 50], [30, -150, 50], [210, -90, 50],
    [140, 40, 40], [170, -40, 40], [80, 20, 40], [40, 230, 50], [130, -230, 50], [240, 140, 40], [-200, 180, 40], [0, 60, 40]].forEach(([x, z, rad], i) => {
    addSchool('reef', Z(x, z, rad, -70, -3), 18 + (i % 3) * 6, 14, { rad: 2.6, hug: [1.5, 5], col: REEFC[i % REEFC.length] }); });
  // more reef and open-water species (ambient, not codex entries), several right around the base ship so fish are easy to find
  const R = (sp, spots, n, extra, o) => spots.forEach(([x, z], i) => addSchool(sp, Z(x, z, o.zone || 35, -75, -3), typeof n === 'function' ? n(i) : n, extra, { scale: 1.3, ...o }));
  R('butter', [[70, -30], [120, 40], [180, -80], [210, 60], [150, 120], [40, 190], [90, -190], [-20, 80], [230, 210], [-170, 200], [25, 15]], (i) => 4 + (i % 3) * 2, 2, { rad: 1.8, hug: [1, 4] });
  R('angel', [[100, 0], [160, -20], [200, 120], [60, 220], [120, -220], [-30, 60], [250, 180], [140, 80], [-15, 25]], (i) => 2 + (i % 2), 1, { rad: 1.2, hug: [1.5, 5] });
  R('parrot', [[130, -50], [190, 20], [90, 90], [20, 210], [60, -170], [220, -100], [-190, 190], [40, -30]], (i) => 2 + (i % 3), 1, { rad: 2, hug: [1, 3] });
  R('idol', [[110, 60], [170, 140], [80, -110], [-40, 100], [210, -40], [100, 200], [10, -55]], (i) => 3 + (i % 3), 2, { rad: 1.5, hug: [2, 5] });
  R('puffer', [[125, 10], [175, 70], [70, 160], [50, -130], [200, 190], [-10, 50], [150, -100], [230, 20], [30, -10]], (i) => 1 + (i % 2), 0, { rad: 0.8, hug: [1, 3], zone: 20 });
  R('grouper', [[100, -80], [200, 0], [40, 220], [140, -230], [-200, 220], [260, 120], [55, 40]], 1, 0, { rad: 0.5, hug: [1, 3], zone: 25 });
  R('snapper', [[30, 30], [110, -10], [200, 80], [70, 210], [100, -210], [-160, 60], [-80, -80], [-20, -60]], (i) => 18 + (i % 3) * 6, 10, { rad: 4, hug: [3, 9] });
  addSchool('barra', Z(0, 0, 160, -60, -12), 12, 4, { rad: 5, spd: 2 }); addSchool('barra', Z(250, -250, 140, -60, -12), 14, 4, { rad: 5, spd: 2 });
  addSchool('barra', Z(-250, 250, 140, -60, -12), 10, 4, { rad: 5, spd: 2 }); addSchool('barra', Z(300, 300, 140, -60, -12), 12, 4, { rad: 5, spd: 2 });
  // companions that follow the sub within a depth band [min, max] metres
  const home = Z(0, 0, 60, -40, -4);
  addSchool('snapper', home, 26, 0, { rad: 4, hug: [3, 8], scale: 1.35, amb: [0, 80] }); addSchool('reef', home, 22, 0, { rad: 2.6, hug: [1.5, 5], col: '#ffd23f', scale: 1.35, amb: [0, 80] });
  addSchool('butter', home, 8, 0, { rad: 1.8, hug: [1, 4], scale: 1.35, amb: [0, 80] }); addSchool('parrot', home, 3, 0, { rad: 2, hug: [1, 3], scale: 1.3, amb: [0, 70] });
  addSchool('reef', home, 20, 0, { rad: 2.6, hug: [1.5, 6], col: '#3fa7ff', scale: 1.35, amb: [0, 80] });
  addSchool('sardine', home, 34, 0, { rad: 5, scale: 1.2, amb: [30, 260] }); addSchool('barra', home, 12, 0, { rad: 5, spd: 2, amb: [50, 300] });
  addSchool('lantern', home, 26, 0, { rad: 4.5, amb: [220, 900] }); addSchool('lantern', home, 20, 0, { rad: 4.5, amb: [300, 900] });
  flora.anems.forEach((a) => { for (let k = 0; k < 2; k++) addC('clownfish', Z(a.x, a.z, 3, a.y - 1, a.y + 2), { at: a.clone().add(new V3(rr(-1, 1), 0.8, rr(-1, 1))), need: k ? rr(0.1, 0.5) : 0, extra: { home: a.clone().add(new V3(0, 0.8, 0)) } }); });
  for (let i = 0; i < 32; i++) addC('tang', i < 20 ? Z(150, 20, 90, -60, -8) : Z(rpick([60, 90, 200]), rpick([-200, 200, 120]), 60, -60, -8), { need: i < 10 ? 0 : rr(0.1, 0.8) });
  for (let i = 0; i < 10; i++) addC('turtle', i < 6 ? Z(0, 0, 360, -70, -3) : Z(150, 20, 150, -60, -4), { need: i < 3 ? 0 : rr(0.15, 0.8) });
  for (let i = 0; i < 22; i++) { const x = rr(-230, -80), z = rr(-150, 130), y = heightAt(x, z) + rr(4, 12); addC('seahorse', Z(x, z, 2, y - 2, y + 2), { at: new V3(x, y, z), need: i < 8 ? 0 : rr(0.1, 0.7) }); }
  for (let i = 0; i < 40; i++) { const [x, z] = polar(0, 0, 20, 420); addC('crab', Z(x, z, 40, -1000, 0), { at: new V3(x, heightAt(x, z) + 0.2, z), need: i < 16 ? 0 : rr(0.1, 0.7) }); }
  for (let i = 0; i < 56; i++) { const [x, z] = polar(0, 0, 110, 620); addC('jelly', Z(x, z, 40, -300, -12), { extra: { hue: rpick([190, 280, 320, 30, 170]) } }); }
  for (let i = 0; i < 8; i++) addC('manta', [Z(300, 250, 200, -160, -15), Z(-300, -250, 200, -160, -15), Z(150, 20, 160, -70, -10), Z(-150, 200, 180, -120, -12)][i % 4], { need: i < 2 ? 0 : rr(0.2, 0.7) });
  [[-330, 0, 120, -250, -40], [330, 60, 120, -250, -40], [-500, 260, 150, -330, -150], [480, -300, 150, -330, -150], [100, 340, 120, -150, -30]].forEach((z) => addC('shark', Z(...z)));
  for (let i = 0; i < 4; i++) addC('whale', Z(0, 0, 600, -100, -8), { need: [0, 0.35, 0.55, 0.75][i] });
  for (let i = 0; i < 14; i++) addC('dolphin', i < 8 ? Z(260, 240, 220, -25, -2) : Z(-200, -250, 200, -25, -2), { need: i < 4 ? 0 : rr(0.15, 0.75), extra: { jumpCd: rr(3, 12) } });
  for (const [ax, az] of [[-560, 180], [520, -260], [-720, -40], [740, 60], [-400, 480], [420, 420], [-600, -300]]) { const x = ax + rr(-30, 30), z = az + rr(-30, 30); addC('angler', Z(x, z, 60, -900, -280), { at: new V3(x, heightAt(x, z) + rr(3, 9), z) }); }
  for (let i = 0; i < 12; i++) { const [x, z] = polar(0, 0, 200, 560); if (heightAt(x, z) < -380) { i--; continue; } addC('octopus', Z(x, z, 30, -1000, 0), { at: new V3(x, heightAt(x, z) + 0.3, z), need: i < 3 ? 0 : rr(0.2, 0.6), extra: { col: rpick(['#c0553a', '#b8462e', '#d06a40']) } }); }
  for (let i = 0; i < 8; i++) addC('dumbo', i < 5 ? Z(-760, 60, 90, -860, -600) : Z(760, 60, 90, -660, -480));
  addC('squid', Z(-770, 80, 90, -840, -640));
  // hagfish and crabs picking at the whale fall; vent shrimp swarming the chimney bases
  { const wf = POI.whalefall, c = Math.cos(0.4), s = Math.sin(0.4); for (let k = 0; k < 3; k++) { const t = k / 2, lx = 4 - t * 12; addSchool('hagfish', Z(wf.x + lx * c, wf.z - lx * s, 5, -900, -3), 6, 0, { rad: 2.2, hug: [0.3, 1.5], scale: 1.2, spd: 0.8 }); }
    for (let i = 0; i < 10; i++) { const lx = rr(-10, 9), lz = rr(-4, 4), x = wf.x + lx * c + lz * s, z = wf.z - lx * s + lz * c; addC('crab', Z(x, z, 6, -1000, 0), { at: new V3(x, heightAt(x, z) + 0.2, z) }); } }
  for (const v of pieces.vents.slice(0, 5)) addSchool('shrimp', Z(v.x, v.z, 4, -1000, -3), 40, 0, { rad: 2.4, hug: [0.8, 4], scale: 1.3, spd: 0.7 });
  // fish that move in once a cleanup site is clean: the wreck and the airliner become artificial reefs
  const site = (id, sp, n, o) => { const ps = pieces.sites[id]; addSchool(sp, Z(ps.center.x, ps.center.z, ps.r * 0.6, -900, -3), n, 0, { scale: 1.3, site: id, ...o }); };
  site('wreck', 'snapper', 30, { rad: 5, hug: [9, 16] }); site('wreck', 'reef', 22, { rad: 3, hug: [9, 15], col: '#ffd23f' }); site('wreck', 'barra', 10, { rad: 5, hug: [13, 22], spd: 2 });
  site('wreck', 'grouper', 3, { rad: 2, hug: [2, 6] }); site('wreck', 'butter', 6, { rad: 2, hug: [9, 13] });
  site('bleach', 'reef', 24, { rad: 2.6, hug: [1.5, 5], col: '#ff7b54' }); site('bleach', 'reef', 20, { rad: 2.6, hug: [1.5, 5], col: '#3fa7ff' }); site('bleach', 'butter', 8, { rad: 1.8, hug: [1, 4] }); site('bleach', 'angel', 4, { rad: 1.2, hug: [1.5, 5] }); site('bleach', 'parrot', 3, { rad: 2, hug: [1, 3] });
  site('plane', 'snapper', 22, { rad: 4, hug: [4, 9] }); site('plane', 'reef', 18, { rad: 2.6, hug: [3, 7], col: '#ff7b54' }); site('plane', 'grouper', 2, { rad: 1.5, hug: [1.5, 4] }); site('plane', 'angel', 3, { rad: 1.4, hug: [2, 5] });
  for (const sp of FISH_KINDS) { const cnt = sp === 'clownfish' || sp === 'tang' ? creatures.filter((c) => c.sp === sp).length : schools.filter((s) => s.sp === sp).reduce((s, sc) => s + sc.m.length, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: sp === 'sardine' ? 0.5 : sp === 'barra' || sp === 'snapper' ? 0.35 : 0.1, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = U.time; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float fph = float(gl_InstanceID)*1.7; float tk = smoothstep(0.05, -0.3, position.z); transformed.x += sin(uTime*11.0 + fph + position.z*14.0) * tk * 0.09;'); };
    mat.customProgramCacheKey = () => 'fishwiggle';
    const im = new THREE.InstancedMesh(fishGeo(sp), mat, Math.max(1, cnt)); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); FISHIM[sp] = { im, n: 0 }; }
  { let i = 0; const c = new THREE.Color(), im = FISHIM.reef.im; for (const s of schools) if (s.sp === 'reef') for (const m of s.m) { c.set(s.col).offsetHSL(rr(-0.03, 0.03), 0, rr(-0.08, 0.06)); im.setColorAt(i++, c); } im.instanceColor.needsUpdate = true; }
  FISHIM.lanternDots = new THREE.InstancedMesh(lanternDotsGeo(), new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fe8ff').multiplyScalar(3), fog: false }), FISHIM.lantern.im.count); FISHIM.lanternDots.frustumCulled = false; scene.add(FISHIM.lanternDots);
}
function fishMatrix(pos, dir, scale, out) { tv2.copy(dir); if (tv2.lengthSq() < 1e-6) tv2.set(0, 0, 1); tv2.normalize(); tm.lookAt(tv2, ZERO, UPV); tq.setFromRotationMatrix(tm); out.compose(pos, tq, ts.setScalar(scale)); return out; }
const OCT_HIDE = new THREE.Color('#5a4a3a'); // an octopus fades to rock colour when the sub is close
function faceVel(e, dt, rate = 4, maxPitch = 0.6) { tv2.copy(e.vel); if (tv2.lengthSq() < 0.01) return; tv2.y = clamp(tv2.y, -Math.hypot(tv2.x, tv2.z) * Math.tan(maxPitch), Math.hypot(tv2.x, tv2.z) * Math.tan(maxPitch)); tv2.normalize(); tm.lookAt(tv2, ZERO, UPV); tq.setFromRotationMatrix(tm); e.q.slerp(tq, 1 - Math.exp(-rate * dt)); }
function steer(e, tx, ty, tz, spd, acc, dt) { tv1.set(tx - e.pos.x, ty - e.pos.y, tz - e.pos.z); const d = tv1.length() || 1; tv1.multiplyScalar(spd / d).sub(e.vel).multiplyScalar(Math.min(1, acc * dt)); e.vel.add(tv1); }
function newTarget(e) { zonePoint(e.z, e.r, e.tgt); }
function wander(e, dt, mul = 1, acc = 1.2) { e.timer -= dt; if (e.timer <= 0 || e.pos.distanceToSquared(e.tgt) < 9) { newTarget(e); e.timer = rnd(5, 12); } steer(e, e.tgt.x, e.tgt.y, e.tgt.z, e.spd * mul, acc, dt); }
function avoid(e, dt, maxY = -1) { const ax = e.pos.x + e.vel.x * 1.2, az = e.pos.z + e.vel.z * 1.2; const fl = heightAt(ax, az) + e.r + 1.2; if (e.pos.y + e.vel.y * 1.2 < fl) { e.vel.y += (fl - e.pos.y) * 2 * dt + e.spd * dt * 2; if (e.timer > 0.5) e.timer = 0.5; }
  const f0 = heightAt(e.pos.x, e.pos.z) + e.r * 0.6; if (e.pos.y < f0) e.pos.y = f0; if (e.pos.y > maxY - e.r * 0.5) { e.pos.y = maxY - e.r * 0.5; if (e.vel.y > 0) e.vel.y *= -0.3; }
  const lim = 860; if (Math.abs(e.pos.x) > lim) e.vel.x -= Math.sign(e.pos.x) * 3 * dt; if (Math.abs(e.pos.z) > lim) e.vel.z -= Math.sign(e.pos.z) * 3 * dt; }
function updateCreature(e, dt) {
  const act = G.clean >= e.need; e.a += ((act ? 1 : 0) - e.a) * Math.min(1, dt * 0.7);
  const dc = e.pos.distanceTo(camera.position);
  if (e.root) { e.root.visible = e.a > 0.02 && dc < (e.sp === 'whale' ? 420 : 240); }
  if (e.a < 0.01) return;
  if (dc > 360 && e.sp !== 'whale') return;
  e.t += dt;
  const play = G.state === 'play' && e.a > 0.6 && P.alive; tv3.subVectors(P.pos, e.pos); const dp = tv3.length() || 1;
  let integrate = true, maxY = -1;
  switch (e.sp) {
    case 'jelly': { e.timer -= dt; if (e.timer <= 0) { e.timer = rnd(2.2, 3.6); e.vel.y = rnd(0.8, 1.5); } e.vel.y = Math.max(e.vel.y - 0.5 * dt, -0.3); e.vel.x = Math.sin(e.t * 0.2 + e.ph) * 0.3; e.vel.z = Math.cos(e.t * 0.17 + e.ph) * 0.3;
      if (e.pos.y > e.z.y1) e.vel.y = Math.min(e.vel.y, -0.4); if (e.pos.y < e.z.y0) e.vel.y = Math.max(e.vel.y, 0.6); avoid(e, dt);
      if (play && dp < e.r + 1.6 && P.inv <= 0) { damage(8, '해파리'); AU.zap(); G.flashCol = '170,120,255'; P.vel.addScaledVector(tv3.normalize(), 8); tip('jelly', '해파리에 쏘였습니다! 빛나는 촉수에 닿지 않도록 피하세요.'); }
      break; }
    case 'shark': { e.cd -= dt;
      if (e.state === 0) { wander(e, dt, 1, 1.1); if (play && dp < 32 && e.cd <= 0) { e.state = 1; e.chaseT = 7; } }
      else if (e.state === 1) { steer(e, P.pos.x, P.pos.y, P.pos.z, Math.max(e.spd * 1.6, S.speed * 0.8), 2.2, dt); e.chaseT -= dt; setAlert('상어 접근 · Q 소나로 쫓아내기', 1);
        if (dp < e.r + 1.6) { damage(16, '상어'); AU.bite(); e.state = 2; e.fleeT = 4; e.cd = 9; tip('shark', '상어는 소나 핑(Q)을 싫어합니다. 쫓아내 보세요!'); }
        if (e.chaseT <= 0 || !play) { e.state = 0; e.cd = 6; } }
      else { steer(e, e.pos.x - tv3.x / dp * 40, e.pos.y - tv3.y / dp * 10, e.pos.z - tv3.z / dp * 40, e.spd * 1.6, 2, dt); e.fleeT -= dt; if (e.fleeT <= 0) { e.state = 0; newTarget(e); } }
      avoid(e, dt); break; }
    case 'angler': { e.cd -= dt;
      if (e.state === 1) { e.lunge -= dt; if (play && dp < e.r + 1.5) { damage(12, '아귀'); AU.bite(); e.state = 0; e.cd = 4; } if (e.lunge <= 0) e.state = 0; }
      else { steer(e, e.home.x + Math.sin(e.t * 0.1 + e.ph) * 14, e.home.y + Math.sin(e.t * 0.13 + e.ph) * 3, e.home.z + Math.cos(e.t * 0.08 + e.ph) * 14, e.spd, 0.8, dt);
        if (play && dp < 9 && e.cd <= 0) { e.state = 1; e.lunge = 0.7; e.vel.copy(tv3).multiplyScalar(14 / dp); e.cd = 4; } }
      avoid(e, dt); addGlow(e.root.localToWorld(tv2.copy(e.model.lure.position)), 0x9ff6ff, 6); break; }
    case 'squid': { e.cd -= dt;
      if (play && dp < 25 && e.cd <= 0) { for (let i = 0; i < 60; i++) FXN.emit(PT.INK, e.pos.x + rnd(-3, 3), e.pos.y + rnd(-2, 2), e.pos.z + rnd(-3, 3), rnd(-2, 2), rnd(-2, 2), rnd(-2, 2), rnd(3, 6), rnd(1.5, 3.5), 0.02, 0.01, 0.04, 0.85); e.vel.copy(tv3).multiplyScalar(-22 / dp); e.cd = 16; e.timer = 4; AU.noise(0.6, 0.2, 'lowpass', 400, 1); }
      else if (e.vel.length() < e.spd * 1.4) wander(e, dt, 1, 0.5); else e.vel.multiplyScalar(Math.pow(0.5, dt));
      avoid(e, dt); break; }
    case 'whale': { e.breathT = (e.breathT ?? rnd(20, 50)) - dt;
      if (e.breathT <= 0) { e.tgt.set(e.pos.x + rr(-60, 60), -4, e.pos.z + rr(-60, 60)); e.timer = 16; e.breathT = rnd(55, 85); }
      wander(e, dt, 1, 0.4); e.spoutCd = (e.spoutCd || 0) - dt;
      if (e.pos.y > -9 && e.spoutCd <= 0) { e.spoutCd = 10; fwdOf(0, 0, tv2).applyQuaternion(e.q); for (let i = 0; i < 50; i++) FXA.emit(PT.SPLASH, e.pos.x + tv2.x * 3, 1, e.pos.z + tv2.z * 3, rnd(-1.5, 1.5), rnd(8, 14), rnd(-1.5, 1.5), 2, rnd(0.2, 0.5), 0.9, 0.95, 1, 0.8); if (dp < 150) AU.splash(0.08); }
      e.songCd = (e.songCd ?? rnd(5, 15)) - dt; if (dp < 160 && e.songCd <= 0 && e.a > 0.5 && G.state !== 'title') { AU.whale(clamp(0.2 - dp / 1000, 0.04, 0.18)); e.songCd = rnd(22, 40); }
      avoid(e, dt, -2); break; }
    case 'dolphin': { const py = e.pos.y;
      if (e.state === 1) { e.vel.y -= 16 * dt; maxY = 99; if (e.pos.y < -1 && e.vel.y < 0) { e.state = 0; for (let i = 0; i < 26; i++) FXA.emit(PT.SPLASH, e.pos.x + rnd(-1, 1), 0.2, e.pos.z + rnd(-1, 1), rnd(-3, 3), rnd(3, 8), rnd(-3, 3), 1.2, rnd(0.15, 0.35), 0.9, 0.95, 1, 0.8); if (dp < 100) AU.splash(0.12); } }
      else { wander(e, dt, 1, 1.4); e.jumpCd -= dt; if (e.jumpCd <= 0 && e.pos.y > -6 && Math.hypot(e.vel.x, e.vel.z) > 5) { e.state = 1; e.vel.y = rnd(9, 12); e.jumpCd = rnd(5, 14); } avoid(e, dt, -0.8); }
      if (py < 0 && e.pos.y >= 0) for (let i = 0; i < 18; i++) FXA.emit(PT.SPLASH, e.pos.x, 0.2, e.pos.z, rnd(-2, 2), rnd(3, 7), rnd(-2, 2), 1, rnd(0.15, 0.3), 0.9, 0.95, 1, 0.8);
      break; }
    case 'clownfish': case 'seahorse': case 'dumbo': { const rx = e.sp === 'dumbo' ? 5 : e.sp === 'seahorse' ? 0.4 : 1.2, ry = e.sp === 'dumbo' ? 2 : e.sp === 'seahorse' ? 0.8 : 0.4;
      let tx = e.home.x + Math.cos(e.t * 0.6 + e.ph) * rx, ty = e.home.y + Math.sin(e.t * 0.85 + e.ph) * ry, tz = e.home.z + Math.sin(e.t * 0.5 + e.ph) * rx, sp = e.spd;
      if (play && dp < 6 && e.sp === 'clownfish') { tx = e.home.x; ty = e.home.y - 0.4; tz = e.home.z; sp *= 2.2; }
      steer(e, tx, ty, tz, sp, 2, dt); if (e.sp === 'dumbo') avoid(e, dt); break; }
    case 'crab': case 'octopus': { integrate = false; e.timer -= dt;
      if (e.timer <= 0) { e.timer = rnd(1.5, 5); e.walk = Math.random() < 0.65 ? 1 : 0; e.head = rnd(0, TAU); }
      if (e.sp === 'octopus') { const near = play && dp < 8; e.hide = (e.hide || 0) + ((near ? 1 : 0) - (e.hide || 0)) * Math.min(1, dt * 3); e.model.mat.color.set(e.col).lerp(OCT_HIDE, e.hide * 0.8); e.cd -= dt; if (near && e.cd <= 0) { e.cd = 10; for (let i = 0; i < 24; i++) FXN.emit(PT.INK, e.pos.x + rnd(-1, 1), e.pos.y + rnd(0, 1), e.pos.z + rnd(-1, 1), rnd(-1, 1), rnd(0, 1), rnd(-1, 1), rnd(2, 4), rnd(0.6, 1.4), 0.02, 0.01, 0.04, 0.8); } }
      if (e.walk) { const nx = e.pos.x + Math.sin(e.head) * e.spd * dt, nz = e.pos.z + Math.cos(e.head) * e.spd * dt; if (Math.hypot(nx - e.home.x, nz - e.home.z) > e.z.rad) e.head += Math.PI; else { e.vel.set(nx - e.pos.x, 0, nz - e.pos.z).divideScalar(dt); e.pos.x = nx; e.pos.z = nz; } } else e.vel.set(0, 0, 0);
      e.pos.y = heightAt(e.pos.x, e.pos.z) + 0.15; tq.setFromAxisAngle(UPV, e.sp === 'crab' ? e.head + Math.PI / 2 : e.head); e.q.slerp(tq, 1 - Math.exp(-3 * dt)); break; }
    default: { wander(e, dt, 1, e.sp === 'turtle' ? 0.8 : 1.2);
      if (play && dp < (e.sp === 'tang' ? 5 : 8) && e.sp !== 'manta' && e.sp !== 'turtle') steer(e, e.pos.x - tv3.x / dp * 20, e.pos.y - tv3.y / dp * 5, e.pos.z - tv3.z / dp * 20, e.spd * 2.2, 3, dt);
      if (e.freed && e.timer > 0) steer(e, e.tgt.x, e.tgt.y, e.tgt.z, e.spd * 1.6, 2, dt);
      avoid(e, dt); }
  }
  if (integrate) { e.pos.addScaledVector(e.vel, dt); if (e.pos.y > maxY) { e.pos.y = maxY; if (e.vel.y > 0) e.vel.y = 0; } if (e.sp !== 'jelly' && e.sp !== 'seahorse' && e.sp !== 'dumbo') faceVel(e, dt, e.sp === 'whale' ? 0.8 : 4, e.sp === 'dolphin' ? 1.2 : e.sp === 'whale' ? 0.25 : 0.6); }
  if (e.root && e.root.visible) { e.root.position.copy(e.pos); e.root.quaternion.copy(e.q); const s = e.a * (e.sp === 'whale' ? 1 : 1); e.root.scale.setScalar(Math.max(0.001, s)); e.model.anim(e.t, e, dc < 70); }
  if (e.sp === 'jelly' && e.root.visible) addGlow(e.pos, e.model.glow.getHex(), 3);
}
// Ambient schools keep company with the sub inside their depth band: once left behind they fade out
// and reappear ahead of it, so there are always fish in view.
function ambientSpot(s, out, near, far, ahead) {
  const a = P.yaw + (ahead ? rnd(-1.1, 1.1) : rnd(0, TAU)), d = rnd(near, far), x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d, fl = heightAt(x, z);
  const y = s.hug ? fl + rnd(s.hug[0], s.hug[1]) : clamp(P.pos.y + rnd(-6, 6), fl + 4, -2);
  return out.set(x, Math.min(-2, y), z);
}
function updateAmbient(s) {
  const dep = -P.pos.y; s.on = dep >= s.amb[0] && dep <= s.amb[1] && P.pos.y < -1.5;
  if (s.on && (!s.was || Math.hypot(s.pos.x - P.pos.x, s.pos.z - P.pos.z) > 70)) {
    ambientSpot(s, s.pos, 22, 38, true); s.tgt.copy(s.pos); s.timer = 0.5;
    for (const m of s.m) { m.pos.copy(s.pos).add(m.o); m.vel.set(0, 0, 0); m.a = 0; }
  }
  s.was = s.on;
}
function updateSchool(s, dt) {
  if (s.amb) updateAmbient(s); else if (s.site) s.on = !!(SV && SV.sites[s.site]);
  const near = s.pos.distanceTo(camera.position) < 320; if (!near && G.state !== 'title') return;
  s.timer -= dt; if (s.timer <= 0 || s.pos.distanceToSquared(s.tgt) < 25) { if (s.amb) ambientSpot(s, s.tgt, 10, 32, false); else zonePoint(s.z, 4, s.tgt); if (s.hug && !s.amb) s.tgt.y = Math.min(-2, heightAt(s.tgt.x, s.tgt.z) + rnd(s.hug[0], s.hug[1])); s.timer = rnd(6, 12); }
  tv3.subVectors(s.pos, P.pos); const dp = tv3.length() || 1; let spd = s.spd || (s.sp === 'sardine' ? 4 : s.hug ? 1.6 : 2.5);
  // reef fish let the sub come close before darting off
  if (dp < (s.hug ? 8 : 18) && G.state === 'play') { s.tgt.copy(s.pos).addScaledVector(tv3, 30 / dp); s.tgt.y = clamp(s.tgt.y, heightAt(s.tgt.x, s.tgt.z) + 4, -2); spd *= 2.3; s.timer = 1.5; }
  tv1.subVectors(s.tgt, s.pos); tv1.multiplyScalar(spd / (tv1.length() || 1)).sub(s.vel).multiplyScalar(Math.min(1, 1.1 * dt)); s.vel.add(tv1);
  const fl = heightAt(s.pos.x + s.vel.x, s.pos.z + s.vel.z) + (s.hug ? 1.5 : 5); if (s.pos.y < fl) s.vel.y += (fl - s.pos.y) * dt * 3;
  s.pos.addScaledVector(s.vel, dt); if (s.pos.y > -2) s.pos.y = -2;
  const rot = G.t * 0.3, c = Math.cos(rot), si = Math.sin(rot);
  for (const m of s.m) { m.a += ((s.on !== false && G.clean >= m.need ? 1 : 0) - m.a) * Math.min(1, dt * 0.7);
    const tx = s.pos.x + m.o.x * c - m.o.z * si * 0.3 + Math.sin(G.t * 0.8 + m.o.y * 5) * 0.4, ty = s.pos.y + m.o.y + Math.cos(G.t * 0.9 + m.o.x) * 0.25, tz = s.pos.z + m.o.z * c + m.o.x * si * 0.3;
    const kk = Math.min(1, dt * 2.4); m.vel.x += ((tx - m.pos.x) * 1.8 - m.vel.x) * kk; m.vel.y += ((ty - m.pos.y) * 1.8 - m.vel.y) * kk; m.vel.z += ((tz - m.pos.z) * 1.8 - m.vel.z) * kk;
    tv2.subVectors(m.pos, P.pos); const d2 = tv2.lengthSq(); if (d2 < (s.hug ? 12 : 49) && G.state === 'play') { const d = Math.sqrt(d2) || 1; m.vel.addScaledVector(tv2, 60 * dt / d); }
    const sp = m.vel.length(), mx = spd * 3.2; if (sp > mx) m.vel.multiplyScalar(mx / sp);
    m.pos.addScaledVector(m.vel, dt); if (m.pos.y > -1) m.pos.y = -1; const f = heightAt(m.pos.x, m.pos.z) + 0.5; if (m.pos.y < f) m.pos.y = f; }
}
function writeFish() {
  for (const k in FISHIM) if (FISHIM[k].im) FISHIM[k].n = 0;
  const dots = FISHIM.lanternDots; let dn = 0;
  for (const s of schools) { const R = FISHIM[s.sp]; const vis = s.pos.distanceTo(camera.position) < 200;
    for (const m of s.m) { const i = R.n++; if (!vis || m.a < 0.02) { tm.makeScale(0, 0, 0); } else { tv3.copy(m.vel).add(s.vel); fishMatrix(m.pos, tv3, m.a * s.scale, tm); } R.im.setMatrixAt(i, tm); if (s.sp === 'lantern') dots.setMatrixAt(dn++, tm); } }
  for (const e of creatures) { if (!SMALL[e.sp]) continue; const R = FISHIM[e.sp]; const i = R.n++; if (e.a < 0.02 || e.pos.distanceTo(camera.position) > 160) tm.makeScale(0, 0, 0); else fishMatrix(e.pos, e.vel.lengthSq() > 0.01 ? e.vel : fwdOf(e.ph, 0, tv3), e.sp === 'tang' ? 1.3 : 1.2, tm); R.im.setMatrixAt(i, tm); }
  for (const k of FISH_KINDS) { FISHIM[k].im.instanceMatrix.needsUpdate = true; }
  dots.instanceMatrix.needsUpdate = true;
}

// =====================================================================
// MISSIONS
// =====================================================================
function nearestRescue() { let best = null, bd = 1e18; for (const r of rescues) { if (r.freed) continue; const d = r.pos.distanceToSquared(P.pos); if (d < bd) { bd = d; best = r; } } return best ? best.pos : null; }
const MISSIONS = [
  { t: '첫 수거', d: '쓰레기 5개를 수거하세요. 가까이 다가가거나 조준 후 트랙터 빔(클릭/E)으로 끌어오세요.', goal: 5, p: () => ST().collected, rw: 60, kind: 'trash' },
  { t: '기지선 귀환', d: '기지선 뒤쪽 초록 고리나 그 아래 빛기둥에 들어가세요. 수거물이 자동으로 판매되고 상점이 열립니다.', goal: 1, p: () => ST().sells, rw: 60, tg: () => DOCK, tgl: '기지선 도킹 지점' },
  { t: '장비 강화', d: '기지선에서 업그레이드를 하나 구매하세요.', goal: 1, p: () => ST().upgrades, rw: 100, tg: () => DOCK, tgl: '기지선' },
  { t: '무지개 산호초', d: '기지선 동쪽의 산호초를 찾아가세요.', poi: 'reef', rw: 120 },
  { t: '구조 요청', d: '폐그물에 얽힌 바다생물을 찾아 빔을 비춰 그물을 끊어 주세요.', goal: 1, p: () => ST().rescues, rw: 150, tg: nearestRescue, tgl: '구조 대상' },
  { t: '켈프 숲', d: '기지선 서쪽의 켈프 숲을 탐험하세요.', poi: 'kelp', rw: 120 },
  { t: '하얀 산호 지대', d: '기지선 북쪽 산호가 하얗게 죽어 가고 있습니다(백화). 뜨거운 폐수 배출관 밸브를 빔으로 잠그고, 산호를 덮은 쓰레기를 모두 치우세요.', site: 'bleach', rw: 250, kind: 'site' },
  { t: '더 깊은 바다로', d: '수심 150m에 도달하세요. 먼저 내압 선체를 업그레이드해야 합니다.', goal: 150, p: () => ST().deepest, rw: 150, kind: 'depth' },
  { t: '부지런한 청소부', d: '쓰레기를 누적 40개 수거하세요.', goal: 40, p: () => ST().collected, rw: 200, kind: 'trash' },
  { t: '생물 탐사', d: '해양생물 8종을 발견하세요. 가까이 다가가 화면에 담으면 도감(Tab)에 기록됩니다.', goal: 8, p: () => Object.keys(SV.species).length, rw: 200, kind: 'species' },
  { t: '대양 쓰레기 지대', d: '북동쪽 먼 수면에 떠 있는 거대한 쓰레기 지대를 찾으세요.', poi: 'patch', rw: 200 },
  { t: '추락한 비행기', d: '서쪽 심해 평원에 추락한 비행기가 있다는 신호가 잡혔습니다.', poi: 'plane', rw: 250 },
  { t: '비행기 잔해 정화', d: '추락한 여객기 안팎의 좌석·가방·기체 파편을 모두 수거해 연료 유출을 막으세요.', site: 'plane', rw: 450, kind: 'site' },
  { t: '난파선', d: '북동쪽 심해 평원에 가라앉은 아틀란틱호를 찾으세요.', poi: 'wreck', rw: 250 },
  { t: '난파선 정화', d: '아틀란틱호 갑판과 주변에 흩어진 화물을 모두 수거해 기름 유출을 막으세요.', site: 'wreck', rw: 600, kind: 'site' },
  { t: '독성 제거', d: '유해 드럼통 4개를 수거하세요. 새는 드럼통 근처는 위험합니다.', goal: 4, p: () => ST().types.drum || 0, rw: 300, kind: 'drum' },
  { t: '정화율 30%', d: '바다 정화율 30%를 달성하세요.', goal: 30, p: cleanPct, rw: 300, kind: 'trash' },
  { t: '고래의 무덤', d: '남쪽 심해 평원 어딘가에 거대한 뼈가 잠들어 있습니다.', poi: 'whalefall', rw: 300 },
  { t: '어둠 속으로', d: '수심 450m에 도달하세요.', goal: 450, p: () => ST().deepest, rw: 400, kind: 'depth' },
  { t: '모두 구조', d: '그물에 걸린 모든 바다생물을 구조하세요.', goal: 8, p: () => ST().rescues, rw: 500, tg: nearestRescue, tgl: '구조 대상' },
  { t: '심해 열수구', d: '서쪽 끝 해구 바닥의 열수구를 찾으세요. 뜨거운 분출에 주의!', poi: 'vents', rw: 400 },
  { t: '침몰한 컨테이너선', d: '동쪽 끝 해구 바닥의 컨테이너선을 찾으세요.', poi: 'cship', rw: 400 },
  { t: '심연의 바닥', d: '수심 820m 아래 서쪽 해구 바닥에 도달하세요.', goal: 820, p: () => ST().deepest, rw: 500, kind: 'depth' },
  { t: '심해의 전설', d: '심연의 해구에서 대왕오징어를 찾으세요.', sp: 'squid', rw: 600, tg: () => POI.trench, tgl: '심연의 해구' },
  { t: '정화율 70%', d: '바다 정화율 70%를 달성하세요.', goal: 70, p: cleanPct, rw: 600, kind: 'trash' },
  { t: '되살아난 바다', d: '바다 정화율 95%를 달성하세요. 소나와 지도로 남은 쓰레기를 찾으세요.', goal: 95, p: cleanPct, rw: 2000, kind: 'trash' },
];
function mProg(m) { if (m.site) { const st = SITE[m.site], v = st.valve ? 1 : 0; return [SV.sites[m.site] ? st.total + v : st.total - st.left + (v && SV.valve ? 1 : 0), st.total + v]; } if (m.poi) return [SV.pois[m.poi] ? 1 : 0, 1]; if (m.sp) return [SV.species[m.sp] ? 1 : 0, 1]; return [Math.min(m.p(), m.goal), m.goal]; }
// Where the current mission wants the player to go, with a short label for the HUD guide.
// Recomputed every mission tick into G.guide.
let DEEP_SPOTS = null; // coarse seabed samples for finding the nearest place deep enough
function nearestDeep(depth) {
  if (!DEEP_SPOTS) { DEEP_SPOTS = []; for (let x = -840; x <= 840; x += 40) for (let z = -840; z <= 840; z += 40) DEEP_SPOTS.push([x, z, -heightAt(x, z)]); }
  let best = null, bd = 1e18; for (const [x, z, d] of DEEP_SPOTS) { if (d < depth + 10) continue; const q = (x - P.pos.x) ** 2 + (z - P.pos.z) ** 2; if (q < bd) { bd = q; best = [x, z]; } }
  return best ? new V3(best[0], -depth, best[1]) : null;
}
function nearestItem(ok) { let best = null, bd = 1e18; for (const it of items) { if (it.col || it.locked || !ok(it)) continue; const d = it.pos.distanceToSquared(P.pos); if (d < bd) { bd = d; best = it; } } return best; }
function nearestNewLife() { let best = null, bd = 1e18; const chk = (sp, pos) => { if (!SPECIES[sp] || SV.species[sp]) return; const d = pos.distanceToSquared(P.pos); if (d < bd) { bd = d; best = pos; } };
  for (const c of creatures) if (c.a > 0.5) chk(c.sp, c.pos); for (const sc of schools) if (!sc.amb) chk(sc.sp, sc.pos); return best; }
function mGuide(m) {
  if (!m) return null;
  if (m.poi) return SV.pois[m.poi] ? null : { p: new V3(POI[m.poi].x, POI[m.poi].y, POI[m.poi].z), label: POIS.find((q) => q.id === m.poi).n };
  if (m.tg) { const t = m.tg(); return t ? { p: t.isVector3 ? t : new V3(t.x, t.y, t.z), label: m.tgl || '목표' } : null; }
  if ((m.kind === 'trash' || m.kind === 'drum' || m.kind === 'site') && P.kg >= S.cargo * 0.92) return { p: DOCK, label: '화물 가득 · 기지선에서 판매' };
  if (m.kind === 'trash') { const it = nearestItem(() => true); return it && { p: it.pos, label: '가장 가까운 쓰레기' }; }
  if (m.kind === 'site') { const st = SITE[m.site]; if (S.depth < st.depth) return { p: DOCK, label: '기지선 · 내압 선체 업그레이드' }; if (st.valve && !SV.valve) return { p: bleach.valve.pos, label: '폐수 배출관 밸브 · 빔으로 잠그기' }; if (Math.hypot(P.pos.x - st.c.x, P.pos.z - st.c.z) > st.r + 40) return { p: st.c, label: st.n }; const it = nearestItem((i) => i.site === m.site); return it && { p: it.pos, label: `${st.n} ${st.valve ? '쓰레기' : '잔해'} · ${st.left}개 남음` }; }
  if (m.kind === 'drum') { const it = nearestItem((i) => i.type === 'drum'); return it && { p: it.pos, label: '유해 드럼통' }; }
  if (m.kind === 'depth') { if (S.depth < m.goal) return { p: DOCK, label: '기지선 · 내압 선체 업그레이드' }; const d = nearestDeep(m.goal); return d && { p: d, label: `수심 ${m.goal}m 지점` }; }
  if (m.kind === 'species') { const p = nearestNewLife(); return p && { p, label: '미발견 생물' }; }
  return null;
}

// =====================================================================
// INPUT
// =====================================================================
const IN = { keys: {}, mdx: 0, mdy: 0, lmb: false, locked: false, drag: false, lx: 0, ly: 0, touch: false, joy: { on: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 }, look: { id: null, x: 0, y: 0 }, tBeam: false, tBoost: false, tUp: false, tDown: false, gp: { mx: 0, my: 0, ax: 0, ay: 0, up: 0, beam: false, boost: false, prev: {} } };
// touch joystick: a 12% dead zone and a gentle curve, so small thumb wobbles do nothing and half a push is a slow crawl
const JOY_DZ = 0.12, joyCurve = (m) => (m < JOY_DZ ? 0 : Math.pow((m - JOY_DZ) / (1 - JOY_DZ), 1.3));
// the sideways axis gets its own small dead band, so pushing roughly forward doesn't drift sideways
const joySide = (x) => Math.sign(x) * Math.max(0, Math.abs(x) - 0.1) / 0.9;
const AIM_TOUCH = 0.15;
// on touch the beam takes targets a little further off-centre
const aimPad = () => (IN.touch ? AIM_TOUCH : 0);
const buzz = (ms) => { if (IN.touch && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} };
function inputVec() { if (G.talk) return { f: 0, s: 0, u: 0, beam: false, boost: false }; const k = IN.keys; let f = 0, s = 0, u = 0;
  if (k.KeyW || k.ArrowUp) f += 1; if (k.KeyS || k.ArrowDown) f -= 1; if (k.KeyD || k.ArrowRight) s += 1; if (k.KeyA || k.ArrowLeft) s -= 1; if (k.Space || IN.tUp) u += 1; if (k.KeyC || k.ControlLeft || IN.tDown) u -= 1;
  if (IN.joy.on) { f -= IN.joy.dy; s += joySide(IN.joy.dx); } f -= IN.gp.my; s += IN.gp.mx; u += IN.gp.up;
  return { f, s, u, beam: !!(k.KeyE || k.KeyF || IN.lmb || IN.tBeam || IN.gp.beam), boost: !!(k.ShiftLeft || k.ShiftRight || IN.tBoost || IN.gp.boost) }; }
function pollGamepad(dt) { const pads = navigator.getGamepads ? navigator.getGamepads() : []; let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; } const g = IN.gp; if (!gp) { g.mx = g.my = g.up = 0; g.beam = g.boost = false; return; }
  const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v); g.mx = dz(gp.axes[0] || 0); g.my = dz(gp.axes[1] || 0); const ax = dz(gp.axes[2] || 0), ay = dz(gp.axes[3] || 0); P.yaw -= ax * 2.4 * dt; P.pitch = clamp(P.pitch - ay * 1.8 * dt, -1.25, 1.25);
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed); g.beam = b(7) || b(0); g.boost = b(4); g.up = (b(5) ? 1 : 0) - (b(6) ? 1 : 0);
  const edge = (i) => { const v = b(i), was = g.prev[i]; g.prev[i] = v; return v && !was; }; if (edge(2) || edge(3)) doSonar(); if (edge(9)) togglePause(); if (edge(8)) openMap(); }

// =====================================================================
// PLAYER
// =====================================================================
function setAlert(msg, pri) { if (pri >= G.alertPri) { G.alert = msg; G.alertPri = pri; } }
function damage(v, cause, silent) { if (G.state !== 'play' || v <= 0 || G.story) return; if (!silent && P.inv > 0) return;
  P.hull -= v; if (!silent) { P.inv = 0.7; buzz(40); G.flash = Math.min(0.6, 0.2 + v / 40); G.flashCol = '255,60,60'; G.shake = Math.max(G.shake, 0.15 + v * 0.015); AU.hurt(); P.dmgT = 0.4; burst(P.pos, 14, 1, 0.8, 0.5, 5, 0.18); ftext(P.pos.clone().add(new V3(0, 2, 0)), `-${Math.round(v)}`, '#e5645e', 14); }
  if (P.hull <= 0) { P.hull = 0; fail(cause === '수압' ? 'pressure' : 'hull'); } }
function updatePlayer(dt) {
  const sens = 0.0022 * G.sens; P.yaw -= IN.mdx * sens; P.pitch = clamp(P.pitch - IN.mdy * sens, -1.3, 1.3); IN.mdx = IN.mdy = 0;
  const inp = inputVec(); P.inp = inp;
  // touch: a second after the look thumb lifts, cruising forward without the beam eases a steep pitch back to 26 degrees
  if (IN.touch && IN.look.id == null) { G.lookIdle = (G.lookIdle || 0) + dt; const lim = 0.45; if (G.lookIdle > 1.2 && inp.f > 0.3 && !inp.beam && Math.abs(P.pitch) > lim) P.pitch += (Math.sign(P.pitch) * lim - P.pitch) * Math.min(1, dt * 1.2); } else G.lookIdle = 0;
  const f = fwdOf(P.yaw, P.pitch, P.fwd), r = rightOf(P.yaw, tv2);
  tv1.set(0, 0, 0).addScaledVector(f, inp.f).addScaledVector(r, inp.s).addScaledVector(UPV, inp.u); let ml = tv1.length(); if (ml > 1) { tv1.divideScalar(ml); ml = 1; }
  P.alive = P.bat > 0; if (!P.alive) { tv1.set(0, 0.5, 0); ml = 0; }
  const boosting = inp.boost && P.alive && ml > 0.1; P.boost = boosting; const spd = S.speed * (boosting ? 1.55 : 1);
  tv1.multiplyScalar(spd); P.vel.lerp(tv1, Math.min(1, 2.6 * dt));
  const op = OPV.copy(P.pos); P.pos.addScaledVector(P.vel, dt);
  let impact = 0; const fl = heightAt(P.pos.x, P.pos.z) + 1.5;
  if (P.pos.y < fl) { const n = normalAt(P.pos.x, P.pos.z); P.pos.y = fl; const vn = P.vel.dot(n); if (vn < 0) { impact = Math.max(impact, -vn); P.vel.addScaledVector(n, -vn * 1.2); } }
  for (const c of nearColliders(P.pos.x, P.pos.z)) { tv2.set(P.pos.x - c.x, P.pos.y - c.y, P.pos.z - c.z); const d = tv2.length(), m = c.r + 1.4; if (d < m && d > 0.001) { tv2.divideScalar(d); P.pos.addScaledVector(tv2, m - d); const vn = P.vel.dot(tv2); if (vn < 0) { impact = Math.max(impact, -vn); P.vel.addScaledVector(tv2, -vn * 1.2); } } }
  if (P.pos.y > SURF_Y) { P.pos.y = SURF_Y; if (P.vel.y > 0) P.vel.y = 0; } // surfaced: the sail rides above the waterline
  if ((op.y < -0.3) !== (P.pos.y < -0.3) && Math.abs(P.vel.y) > 0.8) { for (let i = 0; i < 40; i++) FXA.emit(PT.SPLASH, P.pos.x + rnd(-1.5, 1.5), 0.2, P.pos.z + rnd(-1.5, 1.5), rnd(-2, 2), rnd(2, 6), rnd(-2, 2), rnd(0.8, 1.4), rnd(0.2, 0.5), 0.85, 0.95, 1, 0.8); AU.splash(0.25); }
  const lim = 875; P.pos.x = clamp(P.pos.x, -lim, lim); P.pos.z = clamp(P.pos.z, -lim, lim);
  if (impact > 7) { damage((impact - 7) * 2.2, '충돌'); AU.thud(impact / 30); G.shake = Math.max(G.shake, impact / 40); for (let i = 0; i < 20; i++) FXN.emit(PT.SAND, P.pos.x + rnd(-1, 1), P.pos.y - 1, P.pos.z + rnd(-1, 1), rnd(-2, 2), rnd(0, 2), rnd(-2, 2), rnd(2, 4), rnd(0.8, 1.6), 0.55, 0.48, 0.38, 0.5); }
  ST().dist += P.pos.distanceTo(op);
  // visual orientation
  const turn = ((((P.yaw - P.vyaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI; P.vyaw += turn * Math.min(1, dt * 5);
  P.vpitch += (P.pitch * 0.75 - P.vpitch) * Math.min(1, dt * 4); P.roll += (clamp(-turn * 1.5, -0.5, 0.5) - P.roll) * Math.min(1, dt * 4);
  if (G.fp) { const yr = angDelta(P.yaw, P.lyaw ?? P.yaw) / Math.max(dt, 1e-3); P.lyaw = P.yaw; P.yr = (P.yr || 0) + (yr - (P.yr || 0)) * Math.min(1, dt * 10); P.vyaw = P.yaw; P.vpitch = P.pitch; P.roll += (clamp(-yr * 0.035, -0.12, 0.12) - P.roll) * Math.min(1, dt * 3);
    if (ml > 0.3 && Math.random() < dt * (10 + (boosting ? 25 : 0))) { const cp = camera.position, fw = P.fwd; bubble(cp.x + fw.x * 5 + rnd(-2.5, 2.5), cp.y + fw.y * 5 + rnd(-1.8, 1.8), cp.z + fw.z * 5 + rnd(-2.5, 2.5), 0, rnd(0.3, 1), 0, rnd(0.03, 0.08)); } }
  SUB.root.position.copy(P.pos); if (P.pos.y > -1.6) SUB.root.position.y += Math.sin(G.t * 2) * 0.15;
  SUB.root.rotation.set(-P.vpitch, P.vyaw, P.roll, 'YXZ');
  const spin = dt * (3 + ml * 25 + (boosting ? 20 : 0)); SUB.prop.rotation.z += spin; for (const t of SUB.thr) t.rotation.z -= spin * 1.6;
  // the beam projector brightens while the beam is on; the mast beacon flashes every 1.6 s
  SUB.emitter.material.color.setRGB(0.5, 0.91, 1).multiplyScalar(P.beam ? 2.6 : 0.7); SUB.beacon.material.color.setRGB(1, 0.48, 0.18).multiplyScalar(G.t % 1.6 < 0.13 ? 3 : 0.35);
  SUB.root.updateMatrixWorld(); P.nose.set(0, -0.6, 1.78).applyMatrix4(SUB.root.matrixWorld);
  P.thrust = ml; P.beam = inp.beam && P.alive;
  const drain = 0.2 + ml * 0.5 + (boosting ? 1.5 : 0) + (P.beam ? 1.3 : 0);
  if (G.story) P.bat = S.bat; // story mode: no running out of power
  if (P.alive) { P.bat = Math.max(0, P.bat - drain * dt); if (P.bat <= 0) { P.deadT = 0; toast('배터리 방전', 'bad', '비상 부상 장치가 작동했습니다.'); AU.fail(); } }
  else { P.deadT += dt; if (P.deadT > 3.2) fail('battery'); }
  if (ml > 0.1 && Math.random() < dt * (20 + (boosting ? 30 : 0))) { tv2.set(rnd(-0.2, 0.2), rnd(-0.2, 0.2), -2.3).applyMatrix4(SUB.root.matrixWorld); bubble(tv2.x, tv2.y, tv2.z, rnd(-0.5, 0.5), rnd(0.5, 1.5), rnd(-0.5, 0.5), rnd(0.06, 0.16)); }
  if (ml > 0.1 && P.pos.y - heightAt(P.pos.x, P.pos.z) < 5 && Math.random() < dt * 16) FXN.emit(PT.SAND, P.pos.x + rnd(-2, 2), heightAt(P.pos.x, P.pos.z) + 0.3, P.pos.z + rnd(-2, 2), rnd(-1.5, 1.5), rnd(0.3, 1.2), rnd(-1.5, 1.5), rnd(2, 4), rnd(0.6, 1.4), 0.6, 0.53, 0.42, 0.45);
  const dm = depthOf(P.pos.y); if (dm > ST().deepest) ST().deepest = Math.floor(dm);
  if (dm > S.depth) { const over = dm - S.depth; damage((5 + over * 0.25) * dt, '수압', true); setAlert('수압 한계 초과 · 선체 손상 중', 3); G.creakT -= dt; if (G.creakT <= 0) { AU.creak(); G.creakT = rnd(0.8, 1.6); G.shake = Math.max(G.shake, 0.15); } tip('depth', '선체가 수압을 견디지 못합니다! 기지선에서 내압 선체를 업그레이드하세요.'); }
  else if (dm > S.depth * 0.9) setAlert('심도 한계 근접', 1);
  if (P.bat < S.bat * 0.25 && P.alive) { if (P.bat < S.bat * 0.1) setAlert('에너지 부족 · 기지선으로 귀환', 2); if (!G.lowWarned) { G.lowWarned = true; toast('에너지 25% 남음', 'bad', '기지선으로 돌아갈 준비를 하세요.'); } if (P.bat < S.bat * 0.1) { G.alarmT -= dt; if (G.alarmT <= 0) { AU.alarm(); G.alarmT = 2; } } }
  P.inv = Math.max(0, P.inv - dt); P.dmgT = Math.max(0, P.dmgT - dt);
  if (P.hull < S.hull * 0.35 && Math.random() < dt * 6) bubble(P.pos.x + rnd(-1, 1), P.pos.y + 0.8, P.pos.z + rnd(-1, 1));
  // entering the dock zone sells the cargo and opens the shop; leaving it re-arms, so every visit opens it again
  if (!inDockZone(1.5)) P.canDock = true; if (P.canDock && P.alive && inDockZone(0) && !G.story) { P.canDock = false; openDock(); }
  exploreAt(P.pos.x, P.pos.z, Math.max(70, S.light * 1.1));
}
// the green ring and the light column under it, from the surface down to the bottom of the beam
function inDockZone(m) { return Math.hypot(P.pos.x - DOCK.x, P.pos.z - DOCK.z) < 6 + m && P.pos.y < 1.5 + m && P.pos.y > DOCK.y - 30 - m; }
const angDelta = (a, b) => ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
function updateCamera(dt) {
  if (G.fp) { // cockpit view: eye just behind the front viewport
    SUB.root.updateMatrixWorld(); camera.position.set(0, 0.12, 1.0).applyMatrix4(SUB.root.matrixWorld);
    const sp = clamp(P.vel.length() / S.speed, 0, 1.6); camera.position.y += Math.sin(G.t * 1.1) * 0.05 + Math.sin(G.t * 7.5) * 0.03 * sp;
    if (G.shake > 0 && G.shakeOn) camera.position.add(tv3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(G.shake * 0.5));
    camera.rotation.set(P.pitch + Math.sin(G.t * 0.9) * 0.004, P.yaw + Math.PI, P.roll, 'YXZ'); return;
  }
  const f = fwdOf(P.yaw, P.pitch, tv1); const dist = 8;
  tv2.copy(P.pos).addScaledVector(f, -dist).addScaledVector(rightOf(P.yaw, tv3), 1.6); tv2.y += 2.6 + Math.max(0, -P.pitch) * 1.5;
  const fl = heightAt(tv2.x, tv2.z) + 1.2; if (tv2.y < fl) tv2.y = fl;
  camera.position.lerp(tv2, 1 - Math.exp(-dt * 12));
  if (G.shake > 0 && G.shakeOn) camera.position.add(tv3.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(G.shake));
  tv3.copy(P.pos).addScaledVector(f, 7); tv3.y += 1.0; camera.lookAt(tv3);
}

// =====================================================================
// ITEMS UPDATE / COLLECT / RESCUE / SONAR
// =====================================================================
function updateItems(dt) {
  const beamOn = P.beam && G.state === 'play', f = P.fwd, aim = aimPad(), nudge = IN.touch && !beamOn && !SV.tips.tbeam; G.beamNear = false;
  for (const it of items) {
    if (it.col || it.locked) continue;
    const dc2 = it.pos.distanceToSquared(camera.position); if (dc2 > 260 * 260 && it.state === 0) continue;
    let pulled = false;
    if (beamOn) { tv1.subVectors(it.pos, P.nose); const ed = tv1.length() || 1; if (ed < S.beam + it.r) { const cosA = tv1.dot(f) / ed; if (cosA > Math.cos(0.36 + aim + Math.min(0.5, it.r / ed))) {
      const pw = S.beamPow / (1 + it.kg * 0.085); tv1.multiplyScalar(-pw / ed).sub(it.vel).multiplyScalar(Math.min(1, 5 * dt)); it.vel.add(tv1); it.state = 1; pulled = true; it.spin += dt * 3;
      if (Math.random() < dt * 12) FXA.emit(PT.SPARK, it.pos.x + rnd(-it.r, it.r), it.pos.y + rnd(-it.r, it.r), it.pos.z + rnd(-it.r, it.r), -tv1.x, -tv1.y, -tv1.z, 0.4, 0.15, 0.4, 1, 0.9, 1); } } }
    // first touch play: trash right in front makes the beam button pulse until the beam has collected something
    if (nudge && !G.beamNear && it.state === 0 && dc2 < 3600) { tv1.subVectors(it.pos, P.nose); const ed = tv1.length() || 1; if (ed < S.beam + it.r && tv1.dot(f) > ed * 0.8) G.beamNear = true; }
    if (it.state === 1 && !pulled) it.state = 2;
    if (it.state > 0) {
      if (!pulled) { const g = it.buoy > 0 ? 1.8 : it.buoy < 0 ? (it.kg > 5 ? -5 : -2.5) : 0; it.vel.y += g * dt; it.vel.multiplyScalar(Math.pow(0.4, dt)); }
      it.pos.addScaledVector(it.vel, dt);
      const fl = heightAt(it.pos.x, it.pos.z) + it.r * 0.45; if (it.pos.y < fl) { it.pos.y = fl; if (it.vel.y < 0) it.vel.y = 0; if (!pulled && it.buoy < 0 && it.vel.length() < 1) { it.state = 0; it.vel.set(0, 0, 0); it.home.copy(it.pos); } }
      if (it.buoy > 0 && !pulled && it.pos.y > -1.5) { it.pos.y = -1.5; it.state = 0; it.vel.set(0, 0, 0); it.home.copy(it.pos); }
      if (it.buoy === 0 && !pulled && it.vel.length() < 0.3) { it.state = 0; it.home.copy(it.pos); }
      if (it.pos.y > -0.8) it.pos.y = -0.8;
      writeItem(it);
    } else if (it.buoy >= 0 && dc2 < 200 * 200) writeItem(it, 1);
    if (it.leak) { if (dc2 < 90 * 90 && Math.random() < dt * 3) FXA.emit(PT.TOX, it.pos.x + rnd(-0.4, 0.4), it.pos.y + it.r, it.pos.z + rnd(-0.4, 0.4), rnd(-0.2, 0.2), rnd(0.5, 1.2), rnd(-0.2, 0.2), rnd(2, 3.5), rnd(0.15, 0.3), 0.4, 1, 0.3, 0.8);
      if (G.state === 'play' && it.pos.distanceToSquared(P.pos) < (it.r + 4.5) ** 2) { damage(5 * dt, '독성', true); setAlert('독성 물질 · 선체 부식 중', 2); tip('drum', '새는 드럼통 근처는 위험합니다. 멀리서 트랙터 빔으로 끌어오세요.'); } }
    if (G.state === 'play') { const pr = 1.8 + it.r; if (it.pos.distanceToSquared(P.pos) < pr * pr || it.pos.distanceToSquared(P.nose) < (1.2 + it.r) ** 2) tryCollect(it); }
  }
}
// a collected item shrinks and flies into the sub's nose over a quarter second, then pops
const SUCK = [];
function updateSuck(dt) {
  for (let i = SUCK.length - 1; i >= 0; i--) { const s = SUCK[i], it = s.it; s.t += dt / 0.25; const r = IM[it.key];
    if (s.t >= 1 || !it.col) { SUCK.splice(i, 1); writeItem(it); if (s.t >= 1) burst(P.nose, 8, 0.5, 1, 0.9, 3, 0.12); continue; }
    const k = s.t * s.t; tv1.lerpVectors(s.from, P.nose, k); const sc = 1 - k * 0.9; tq.setFromAxisAngle(UPV, s.t * 6).multiply(it.q);
    tm.compose(tv1, tq, ts.set(sc, sc, sc)); r.im.setMatrixAt(it.idx, tm); r.im.instanceMatrix.needsUpdate = true; }
}
const itemName = (it) => TRASH[it.type].n;
function tryCollect(it) {
  if (P.kg + it.kg > S.cargo + 1e-6) { if (G.t - G.fullT > 2.5) { G.fullT = G.t; if (it.kg > S.cargo) toast(`${itemName(it)}은(는) 너무 무겁습니다 (${it.kg}kg)`, 'bad', '화물칸을 업그레이드하세요'); else toast('화물칸이 가득 찼습니다', 'bad', '기지선으로 돌아가 판매하세요.'); }
    tv1.subVectors(it.pos, P.pos).normalize().multiplyScalar(6); it.vel.copy(tv1); it.state = 2; return; }
  it.col = true; SUCK.push({ it, t: 0, from: it.pos.clone() }); P.cargo.push(it.id); P.kg += it.kg; // shrinks into the sub's nose, see updateSuck
  G.combo = G.t - G.comboT < 1.6 ? G.combo + 1 : 0; G.comboT = G.t;
  const s = ST(); s.collected++; s.kg += it.kg; s.types[it.type] = (s.types[it.type] || 0) + 1;
  burst(it.pos, 18, 0.4, 1, 0.9, 5, 0.18);
  FXA.emit(PT.BLIP, it.pos.x, it.pos.y, it.pos.z, 0, 0, 0, 0.5, it.r * 2, 0.4, 1, 0.9, 1, 1);
  ftext(it.pos.clone().add(new V3(0, it.r + 0.5, 0)), `+${it.v}`, '#e8edf1', 14);
  AU.collect(G.combo, it.kg >= 9); buzz(it.kg >= 9 ? 28 : 12); if (IN.tBeam) SV.tips.tbeam = 1;
  if (!SV.tips['t_' + it.type]) { SV.tips['t_' + it.type] = 1; toast(`새로운 쓰레기: ${TRASH[it.type].n}`, 'tip', TRASH[it.type].fact); }
  recount();
}
// right up against a net the beam reaches it whatever the angle
function updateRescues(dt) {
  for (const r of rescues) { if (r.freed) continue; r.t += dt; r.cutting = false;
    const d = r.pos.distanceTo(P.pos); if (d < 40) { r.known = true; tip('net', '그물에 걸린 생물입니다! 조준하고 트랙터 빔을 비춰 그물을 끊어 주세요.'); }
    if (d < 250) { r.model.anim(r.t * 0.5 + Math.sin(r.t * 6) * 0.3, null, true); r.model.root.rotation.z = Math.sin(r.t * 7) * 0.12 * (1 - r.prog * 0.5); r.netMesh.rotation.y += dt * 0.2; r.netMesh.material.opacity = 1 - r.prog * 0.6; }
    if (P.beam && G.state === 'play') { tv1.subVectors(r.pos, P.nose); const ed = tv1.length(); if (ed < 4.5 || (ed < S.beam + 4 && tv1.dot(P.fwd) / ed > Math.cos(0.5 + aimPad()))) { r.cutting = true; r.prog += dt / S.cut; if (Math.random() < dt * 25) FXA.emit(PT.SPARK, r.pos.x + rnd(-1.5, 1.5), r.pos.y + rnd(-1, 1), r.pos.z + rnd(-1.5, 1.5), rnd(-4, 4), rnd(-4, 4), rnd(-4, 4), 0.35, 0.15, 1, 0.9, 0.55, 1); if (Math.random() < dt * 8) AU.cut(); } }
    else r.prog = Math.max(0, r.prog - dt * 0.1);
    r.netMesh.scale.multiplyScalar(1); if (r.prog >= 1) freeAnimal(r); }
}
function freeAnimal(r) {
  r.freed = true; scene.remove(r.netMesh); scene.remove(r.model.root);
  const net = items[r.net]; net.locked = false; net.state = 2; net.vel.set(rnd(-1, 1), 0.5, rnd(-1, 1)); net.known = true; net.rev = G.t + 30; writeItem(net);
  const z = r.sp === 'turtle' ? Z(r.pos.x, r.pos.z, 150, -60, -3) : r.sp === 'dolphin' ? Z(r.pos.x, r.pos.z, 200, -25, -2) : Z(r.pos.x, r.pos.z, 150, r.pos.y - 60, Math.min(-3, r.pos.y + 40));
  const c = addC(r.sp, z, { at: r.pos.clone(), extra: { freed: true, cd: 30 } }); c.a = 1; c.vel.subVectors(r.pos, P.pos).setY(0).normalize().multiplyScalar(c.spd * 1.5); c.vel.y = 1; c.tgt.copy(r.pos).addScaledVector(c.vel, 8); c.tgt.y = Math.min(-3, r.pos.y + 10); c.timer = 6;
  for (let i = 0; i < 30; i++) FXA.emit(PT.SPARK, r.pos.x + rnd(-1, 1), r.pos.y + rnd(-1, 1), r.pos.z + rnd(-1, 1), rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2), rnd(1.2, 2.2), rnd(0.25, 0.45), 1, 0.45, 0.65, 1);
  ST().rescues++; SV.money += 150; AU.rescue(); toast(`${SPECIES[r.sp].n} 구조 완료`, 'good', '보상 +150. 남은 폐그물도 수거하세요.'); ftext(r.pos.clone().add(new V3(0, 2.5, 0)), '+150', '#8fcf9b', 17);
  if (!SV.species[r.sp]) discover(r.sp); saveGame();
}
function doSonar() { if (G.state !== 'play') return; if (G.sonarCd > 0 || P.bat < 3) { AU.click(); return; } P.bat -= 3; G.sonarCd = S.sonarCd; G.sonar = { p: P.pos.clone(), r: 0, max: S.sonar, n: 0 }; AU.ping(); }
function updateSonar(dt) { G.sonarCd = Math.max(0, G.sonarCd - dt); const s = G.sonar; if (!s) { sonarMesh.visible = false; return; }
  const r0 = s.r; s.r += 140 * dt; const a = r0 * r0, b = s.r * s.r; sonarMesh.visible = true; sonarMesh.position.copy(s.p); sonarMesh.scale.setScalar(Math.max(0.1, s.r)); sonarMesh.material.uniforms.uA.value = 1 - s.r / s.max;
  for (const it of items) { if (it.col || it.locked) continue; const d = it.pos.distanceToSquared(s.p); if (d >= a && d < b && s.r <= s.max) { it.known = true; it.rev = G.t + 14; s.n++; } }
  for (const r of rescues) { if (r.freed) continue; const d = r.pos.distanceToSquared(s.p); if (d >= a && d < b) r.known = true; }
  for (const c of creatures) { if (c.sp !== 'shark' && c.sp !== 'angler') continue; const d = c.pos.distanceToSquared(s.p); if (d >= a && d < b && s.r < s.max * 0.9) { c.state = 2; c.fleeT = 5; c.cd = 12; } }
  for (const p of POIS) { const d = (p.x - s.p.x) ** 2 + (p.y - s.p.y) ** 2 + (p.z - s.p.z) ** 2; if (d >= a && d < b) p.pinged = true; }
  if (s.r > s.max) { if (s.n > 0) toast(`소나: 쓰레기 ${s.n}개 탐지`, '', '화면과 지도에 표시됩니다.'); else toast('소나: 주변에 쓰레기가 없습니다', ''); G.sonar = null; sonarMesh.visible = false; } }
// black smoke pouring from the vent chimneys (hot orange at the mouth) and the trench lander's blinking beacon
function updateVents(dt) {
  const cp = camera.position;
  for (const v of pieces.smokers) { if ((cp.x - v.x) ** 2 + (cp.z - v.z) ** 2 > 190 * 190) continue;
    if (Math.random() < dt * 16 * v.k) FXN.emit(PT.SMOKE, v.x + rnd(-0.3, 0.3) * v.k, v.top + 0.2, v.z + rnd(-0.3, 0.3) * v.k, rnd(-0.35, 0.35), rnd(3, 5) * (0.6 + 0.4 * v.k), rnd(-0.35, 0.35), rnd(4, 6) * (0.5 + 0.5 * v.k), rnd(0.5, 0.9) * (0.5 + 0.5 * v.k), 0.018, 0.017, 0.02, 0.92);
    if (Math.random() < dt * 9 * v.k) FXA.emit(PT.SPARK, v.x + rnd(-0.25, 0.25), v.top + 0.15, v.z + rnd(-0.25, 0.25), rnd(-0.3, 0.3), rnd(2, 4), rnd(-0.3, 0.3), rnd(0.35, 0.7), rnd(0.25, 0.55) * v.k, 1, 0.42, 0.1, 1); }
  const b = pieces.beacon, on = Math.sin(G.t * 3.2) > 0.55; b.mesh.visible = on; if (on && b.pos.distanceToSquared(cp) < 160 * 160) addGlow(b.pos, 0xff3b30, 6);
}
function updateHazards(dt) { for (const v of pieces.vents) { if (Math.hypot(P.pos.x - v.x, P.pos.z - v.z) < 2.6 && P.pos.y > v.top - 1 && P.pos.y < v.top + 22) { damage(9 * dt, '열수', true); setAlert('열수 분출 · 고온 주의', 2); } } }

// =====================================================================
// DISCOVERY / DOCK / FAIL / SAVE
// =====================================================================
function discR(sp) { return ({ whale: 90, squid: 55, manta: 50, shark: 45, jelly: 40, lantern: 40, angler: 35, dolphin: 50, turtle: 35 })[sp] || Math.max(22, S.light * 0.5); }
const frustum = new THREE.Frustum();
function discover(sp) { if (SV.species[sp]) return; SV.species[sp] = true; SV.money += 30; AU.discover(); toast(`새로운 생물: ${SPECIES[sp].n}`, 'good', '도감에 기록했습니다. +30'); }
function discoverPOI(p) { SV.pois[p.id] = true; SV.money += 100; AU.discover(); toast(`장소 발견: ${p.n}`, 'big', `${p.d} (+100)`); saveGame(); }
function discoveryTick() {
  frustum.setFromProjectionMatrix(tm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const c of creatures) { if (c.a < 0.5 || SV.species[c.sp]) continue; if (c.pos.distanceTo(P.pos) < discR(c.sp) && frustum.containsPoint(c.pos)) discover(c.sp); }
  for (const s of schools) { if (!SPECIES[s.sp] || SV.species[s.sp]) continue; if (s.pos.distanceTo(P.pos) < discR(s.sp) && frustum.containsPoint(s.pos)) discover(s.sp); }
  if (!SV.species.tubeworm && Math.hypot(P.pos.x - POI.vents.x, P.pos.z - POI.vents.z) < 60 && P.pos.y < POI.vents.y + 40) discover('tubeworm');
  for (const p of POIS) if (!SV.pois[p.id] && Math.hypot(P.pos.x - p.x, P.pos.y - p.y, P.pos.z - p.z) < p.r) discoverPOI(p);
}
function missionTick() {
  if (G.story) { storyTick(); return; }
  siteTick(); const m = MISSIONS[SV.mission]; G.guide = mGuide(m);
  if (m) { const [c, g] = mProg(m); if (c >= g) { SV.money += m.rw; toast(`임무 완료: ${m.t}`, 'big', `보상 +${fmt(m.rw)}`); AU.mission(); SV.mission++; saveGame();
    const n = MISSIONS[SV.mission]; if (n) setTimeout(() => { if (G.state === 'play') toast(`새 임무: ${n.t}`, 'tip', n.d); }, 2200); else setTimeout(() => toast('모든 임무 완료', 'big', '남은 쓰레기를 찾아 바다를 끝까지 되살려 보세요.'), 2200); } }
  if (G.clean >= 0.95 && !SV.won) { SV.won = true; G.pendingWin = 2.5; }
  const h = Math.round(clamp(0.12 + G.clean * 1.15, 0, 1) * 50) / 50; if (h !== G.coralH) { G.coralH = h; flora.setCoralHealth(h); }
}
function openDock() {
  G.state = 'dock'; unlockPointer(); AU.dock(); const rec = sellCargo(); P.bat = S.bat; P.hull = S.hull; P.vel.set(0, 0, 0); G.lowWarned = false; G.alert = '';
  const rows = Object.values(rec.groups).sort((a, b) => b.v - a.v).map((g) => `<tr><td>${esc(g.n)}<span class="q">× ${g.c}</span></td><td>${fmt(g.v)}</td></tr>`).join('');
  $('dSell').innerHTML = rec.total > 0 ? `<table class="receipt">${rows}<tr class="bonus"><td>정화 기금 보너스 +${Math.round(G.clean * 50)}%</td><td>+${fmt(rec.bonus)}</td></tr><tr class="tot"><td>총 수익</td><td>+${fmt(rec.total)}</td></tr></table>`
    : '<div class="empty">판매할 수거물이 없습니다. 바다로 나가 쓰레기를 수거해 오세요.<br>정화율이 높을수록 판매 보너스가 커집니다.</div>';
  $('dSubtitle').textContent = `에너지 충전 · 선체 수리 완료 · 바다 정화율 ${cleanPct()}%`;
  renderUpgrades(); renderStats($('dStat')); switchTab('dock', rec.total > 0 ? 'dSell' : 'dUp'); show('dock'); saveGame();
}
function sellCargo() { const groups = {}; let base = 0; for (const id of P.cargo) { const it = items[id]; const k = it.key; if (!groups[k]) groups[k] = { n: itemName(it), c: 0, v: 0 }; groups[k].c++; groups[k].v += it.v; base += it.v; }
  const bonus = Math.round(base * 0.5 * G.clean), total = base + bonus; if (P.cargo.length) { SV.money += total; ST().earned += total; ST().sells++; AU.sell(); } P.cargo = []; P.kg = 0; return { groups, base, bonus, total }; }
function buyUpgrade(k) { const lv = SV.up[k], cost = UP[k].c[lv]; if (cost === undefined || SV.money < cost) return; SV.money -= cost; SV.up[k]++; ST().upgrades++; calcStats(); P.bat = S.bat; P.hull = S.hull; AU.upgrade(); renderUpgrades(); $('dMoney').textContent = fmt(SV.money); saveGame(); }
function launch() { hide('dock'); G.state = 'play'; tv1.set(P.pos.x - DOCK.x, 0, P.pos.z - DOCK.z); if (tv1.lengthSq() < 1) tv1.set(0, 0, -1); tv1.normalize().multiplyScalar(9); P.vel.set(tv1.x, -2, tv1.z); P.canDock = false; AU.click(); requestLock(); const m = MISSIONS[SV.mission]; if (m && G.t - G.lastMTip > 60) { G.lastMTip = G.t; toast(`임무: ${m.t}`, 'tip', m.d); } }
function fail(kind) {
  if (G.state !== 'play') return; G.state = 'fail'; unlockPointer(); AU.fail();
  const frac = kind === 'battery' ? 0.5 : 1; const cargo = P.cargo.slice().sort(() => Math.random() - 0.5); const nLost = Math.ceil(cargo.length * frac); const lost = cargo.slice(0, nLost); let lkg = 0;
  for (const id of lost) { const it = items[id]; it.col = false; it.pos.copy(it.home); it.state = 0; it.vel.set(0, 0, 0); it.known = true; lkg += it.kg; writeItem(it); }
  P.cargo = cargo.slice(nLost); P.kg = P.cargo.reduce((s, id) => s + items[id].kg, 0);
  const fee = Math.min(SV.money, Math.round(30 + SV.money * 0.08)); SV.money -= fee; ST().fails++; recount();
  const T = { battery: ['배터리 방전', '에너지가 바닥나 비상 부상 장치가 작동했습니다.'], hull: ['선체 파손', '잠수정이 심하게 파손되었습니다.'], pressure: ['수압으로 선체 손상', '한계 수심을 넘어 선체가 버티지 못했습니다.'] }[kind];
  $('failTitle').textContent = T[0]; $('failText').textContent = T[1] + ' 구조대가 잠수정을 기지선까지 견인했습니다.';
  $('failLoss').innerHTML = `잃어버린 화물 <b>${lost.length}개 · ${Math.round(lkg * 10) / 10}kg</b> (원래 자리로 가라앉음)<br>견인 비용 <b>${fmt(fee)}</b>` + (kind === 'pressure' ? '<small>기지선에서 내압 선체를 업그레이드하면 더 깊이 내려갈 수 있습니다.</small>' : kind === 'battery' ? '<small>배터리를 업그레이드하고, 에너지가 25% 남으면 귀환하세요.</small>' : '');
  $('fade').classList.add('on'); setTimeout(() => { $('fade').classList.remove('on'); show('fail'); }, 650); saveGame();
}
function respawn() { hide('fail'); P.pos.copy(DOCK).add(new V3(0, -3, -15)); P.vel.set(0, 0, 0); P.deadT = 0; P.alive = true; P.bat = S.bat; P.hull = S.hull; updateCamera(1); openDock(); }
const SAVE_KEY = 'deepblue3d-ocean-cleaner-v1', SET_KEY = 'deepblue3d-settings-v1';
function saveGame() { if (!SV || G.state === 'title' || G.story) return; try {
  const d = JSON.parse(JSON.stringify(SV)); d.dayT = G.dayT; d.col = []; d.known = []; for (const it of items) { if (it.col) d.col.push(it.id); else if (it.known) d.known.push(it.id); }
  d.cargo = P.cargo.slice(); d.rescued = rescues.filter((r) => r.freed).map((r) => r.id); d.ex = Array.from(EXP).join(''); d.p = [Math.round(P.pos.x * 10) / 10, Math.round(P.pos.y * 10) / 10, Math.round(P.pos.z * 10) / 10, +P.yaw.toFixed(3)]; d.bat = P.bat; d.hull = P.hull;
  localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ } }
function loadGame() { try { const s = localStorage.getItem(SAVE_KEY); if (!s) return null; const d = JSON.parse(s); return d && d.v === 1 ? d : null; } catch (e) { return null; } }
function resetWorld() {
  for (const it of items) { it.col = false; it.pos.copy(it.orig); it.home.copy(it.orig); it.state = 0; it.vel.set(0, 0, 0); it.known = false; it.rev = 0; it.spin = 0; it.locked = false; }
  for (const r of rescues) { r.freed = false; r.prog = 0; r.known = false; items[r.net].locked = true; if (!r.netMesh.parent) scene.add(r.netMesh); if (!r.model.root.parent) scene.add(r.model.root); }
  for (let i = creatures.length - 1; i >= 0; i--) if (creatures[i].freed) { scene.remove(creatures[i].root); creatures.splice(i, 1); }
  for (const p of POIS) p.pinged = false; for (const it of items) writeItem(it);
  resetFog(); P.cargo = []; P.kg = 0; SUCK.length = 0;
}
function applySave(d) {
  SV = Object.assign(freshSave(), d || {}); SV.stats = Object.assign(freshSave().stats, (d && d.stats) || {}); SV.up = Object.assign(freshSave().up, (d && d.up) || {}); SV.species = SV.species || {}; SV.pois = SV.pois || {}; SV.tips = SV.tips || {}; SV.sites = SV.sites || {};
  if (d && !d.mv && SV.mission >= 11) SV.mission += SV.mission >= 12 ? 2 : 1; // v1 saves predate the two site-cleanup missions
  if (d && (d.mv || 1) < 3 && SV.mission >= 6) SV.mission += 1; // and v1/v2 saves predate the bleached reef
  SV.mv = 3;
  for (const k of ['col', 'known', 'cargo', 'rescued', 'ex', 'p', 'bat', 'hull']) delete SV[k];
  resetWorld(); calcStats();
  if (d) { (d.col || []).forEach((id) => { if (items[id]) items[id].col = true; }); (d.known || []).forEach((id) => { if (items[id]) items[id].known = true; });
    (d.rescued || []).forEach((id) => { const r = rescues[id]; if (r) { r.freed = true; items[r.net].locked = false; scene.remove(r.netMesh); scene.remove(r.model.root); } });
    P.cargo = (d.cargo || []).filter((id) => items[id] && items[id].col); P.kg = P.cargo.reduce((s, id) => s + items[id].kg, 0);
    if (typeof d.ex === 'string') for (let k = 0; k < Math.min(d.ex.length, EXP.length); k++) if (d.ex[k] === '1') { EXP[k] = 1; revealFog(k % EXN, Math.floor(k / EXN)); }
    if (Array.isArray(d.p)) { P.pos.set(d.p[0], d.p[1], d.p[2]); P.yaw = d.p[3] || Math.PI; } P.bat = clamp(d.bat ?? S.bat, 1, S.bat); P.hull = clamp(d.hull ?? S.hull, 1, S.hull);
    if (!(P.pos.y < -1) || P.pos.y < heightAt(P.pos.x, P.pos.z)) P.pos.copy(DOCK).add(new V3(0, -3, -15));
    for (const it of items) writeItem(it); }
  else { P.pos.copy(DOCK).add(new V3(0, -3, -15)); P.yaw = Math.PI; P.bat = S.bat; P.hull = S.hull; }
  P.vel.set(0, 0, 0); P.pitch = -0.1; P.vyaw = P.yaw; P.alive = true; P.deadT = 0; P.canDock = false; G.lowWarned = false; G.dayT = SV.dayT || 0.12;
  camera.position.copy(P.pos).add(new V3(0, 3, 9)); recount(); siteTick(true); bleach.valve.prog = 0; bleach.valve.wheel.rotation.y = SV.valve ? TAU * 2 : 0; updateBleach(0, true); G.coralH = -1;
}

// =====================================================================
// MAP (top-down hillshade) & FOG OF WAR
// =====================================================================
const MAPN = 360, EXN = 90, EXP = new Uint8Array(EXN * EXN); let MAPBASE = null, FOG = null, FOGC = null;
function buildMap() {
  const c = document.createElement('canvas'); c.width = c.height = MAPN; const x = c.getContext('2d'); const img = x.createImageData(MAPN, MAPN), d = img.data; const s = WORLD.size / MAPN;
  for (let j = 0; j < MAPN; j++) for (let i = 0; i < MAPN; i++) { const wx = -WORLD.half + (i + 0.5) * s, wz = -WORLD.half + (j + 0.5) * s, h = heightAt(wx, wz), k = (j * MAPN + i) * 4;
    const sh = clamp(0.75 + (heightAt(wx - s, wz - s) - heightAt(wx + s, wz + s)) * 0.035, 0.35, 1.3); const t = clamp(-h / 860, 0, 1);
    const r = lerp(120, 8, Math.pow(t, 0.5)), g = lerp(200, 30, Math.pow(t, 0.55)), b = lerp(230, 70, Math.pow(t, 0.7)); d[k] = r * sh; d[k + 1] = g * sh; d[k + 2] = b * sh; d[k + 3] = 255; }
  x.putImageData(img, 0, 0); MAPBASE = c;
  FOG = document.createElement('canvas'); FOG.width = FOG.height = MAPN; FOGC = FOG.getContext('2d'); resetFog();
}
function resetFog() { if (!FOGC) return; EXP.fill(0); FOGC.globalCompositeOperation = 'source-over'; FOGC.fillStyle = '#01060d'; FOGC.fillRect(0, 0, MAPN, MAPN); }
function revealFog(i, j) { const s = MAPN / EXN; FOGC.save(); FOGC.globalCompositeOperation = 'destination-out'; const g = FOGC.createRadialGradient(i * s + s / 2, j * s + s / 2, 0, i * s + s / 2, j * s + s / 2, s * 1.4); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); FOGC.fillStyle = g; FOGC.fillRect(i * s - s, j * s - s, s * 3, s * 3); FOGC.restore(); }
function exploreAt(x, z, rad) { const cs = WORLD.size / EXN; const i0 = Math.max(0, Math.floor((x - rad + WORLD.half) / cs)), i1 = Math.min(EXN - 1, Math.floor((x + rad + WORLD.half) / cs)), j0 = Math.max(0, Math.floor((z - rad + WORLD.half) / cs)), j1 = Math.min(EXN - 1, Math.floor((z + rad + WORLD.half) / cs));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * EXN + i; if (EXP[k]) continue; const cx = -WORLD.half + (i + 0.5) * cs, cz = -WORLD.half + (j + 0.5) * cs; if ((cx - x) ** 2 + (cz - z) ** 2 > rad * rad) continue; EXP[k] = 1; revealFog(i, j); } }
function drawMapLayer(c, W, H, x0, z0, span, big) {
  const k = W / span, X = (x) => (x - x0) * k, Y = (z) => (z - z0) * k; const ms = MAPN / WORLD.size;
  c.fillStyle = '#01060d'; c.fillRect(0, 0, W, H);
  const sx = (x0 + WORLD.half) * ms, sy = (z0 + WORLD.half) * ms, sw = span * ms, shh = span * (H / W) * ms;
  const csx = Math.max(0, sx), csy = Math.max(0, sy), cex = Math.min(MAPN, sx + sw), cey = Math.min(MAPN, sy + shh);
  if (cex > csx && cey > csy) { const dx = (csx - sx) / sw * W, dy = (csy - sy) / shh * H, dw = (cex - csx) / sw * W, dh = (cey - csy) / shh * H; c.drawImage(MAPBASE, csx, csy, cex - csx, cey - csy, dx, dy, dw, dh); c.drawImage(FOG, csx, csy, cex - csx, cey - csy, dx, dy, dw, dh); }
  const dsz = big ? 3 : 4;
  for (const it of items) { if (it.col || it.locked || !it.known) continue; const x = X(it.pos.x), y = Y(it.pos.z); if (x < 0 || x > W || y < 0 || y > H) continue; c.fillStyle = '#e8925a'; c.fillRect(x - dsz / 2, y - dsz / 2, dsz, dsz); }
  for (const r of rescues) { if (r.freed || !r.known) continue; c.fillStyle = '#e07aa8'; c.beginPath(); c.arc(X(r.pos.x), Y(r.pos.z), big ? 5 : 4, 0, TAU); c.fill(); }
  c.textAlign = 'center';
  for (const p of POIS) { const has = SV.pois[p.id]; if (!has && !p.pinged) continue; const x = X(p.x), y = Y(p.z); if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue; c.fillStyle = has ? '#9fb0bd' : 'rgba(159,176,189,.5)'; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 5, y); c.lineTo(x, y + 6); c.lineTo(x - 5, y); c.fill();
    if (big) { c.font = '600 12px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; const t = has ? p.n : '미확인 신호'; c.strokeText(t, x, y - 10); c.fillText(t, x, y - 10); } }
  const mt = G.guide && G.guide.p; if (mt) { const x = clamp(X(mt.x), 6, W - 6), y = clamp(Y(mt.z), 6, H - 6), p = 0.5 + 0.5 * Math.sin(performance.now() / 200); c.strokeStyle = `rgba(233,196,106,${0.55 + 0.45 * p})`; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 8 + p * 3, 0, TAU); c.stroke(); }
  { const x = X(DOCK.x), y = Y(DOCK.z); c.fillStyle = '#8fcf9b'; c.fillRect(x - 4, y - 8, 8, 16); if (big) { c.font = '600 12px sans-serif'; c.fillText('기지선', x, y - 12); } }
  if (G.sonar) { c.strokeStyle = 'rgba(232,237,241,.5)'; c.lineWidth = 2; c.beginPath(); c.arc(X(G.sonar.p.x), Y(G.sonar.p.z), G.sonar.r * k, 0, TAU); c.stroke(); }
  c.save(); c.translate(X(P.pos.x), Y(P.pos.z)); c.rotate(-P.yaw + Math.PI); c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); c.fill(); c.restore();
}
let MMC = null;
function drawMinimap() { const cv = $('minimap'); const c = MMC || (MMC = cv.getContext('2d')); const W = cv.width, H = cv.height, span = 520; drawMapLayer(c, W, H, P.pos.x - span / 2, P.pos.z - span * H / W / 2, span, false); }
function drawBigMap() { const cv = $('bigmap'), c = cv.getContext('2d'); drawMapLayer(c, cv.width, cv.height, -WORLD.half, -WORLD.half, WORLD.size, true);
  let rem = 0, known = 0; for (const it of items) { if (it.col || it.locked) continue; rem++; if (it.known) known++; } const ex = EXP.reduce((s, v) => s + v, 0) / EXP.length;
  $('mapSub').textContent = `남은 쓰레기 ${rem}개 · 탐지됨 ${known}개 · 해역 탐사 ${Math.round(ex * 100)}% · 현재 수심 ${Math.floor(depthOf(P.pos.y))}m · 북쪽이 위`; }

// =====================================================================
// ENVIRONMENT (fog / light by depth, time of day, cleanliness)
// =====================================================================
const FOG_CLEAN = [[0, '#1f86b8'], [60, '#11629a'], [200, '#0e4a72'], [400, '#0a3556'], [700, '#07263f'], [900, '#051b30']];
const FOG_MURK = [[0, '#3c8676'], [60, '#2a6863'], [200, '#1a4a4e'], [400, '#12353a'], [700, '#0b2529'], [900, '#081b1e']];
function palAt(pal, d) { if (d <= pal[0][0]) return pal[0][1]; for (let i = 1; i < pal.length; i++) if (d <= pal[i][0]) return mixHexSafe(pal[i - 1][1], pal[i][1], (d - pal[i - 1][0]) / (pal[i][0] - pal[i - 1][0])); return pal[pal.length - 1][1]; }
function mixHexSafe(a, b, t) { const c1 = new THREE.Color(a), c2 = new THREE.Color(b); return '#' + c1.lerp(c2, clamp(t, 0, 1)).getHexString(); }
const fogCol = new THREE.Color(), skyTop = new THREE.Color(), skyHor = new THREE.Color();
const EC = { t0: new THREE.Color('#050a1f'), t1: new THREE.Color('#33407a'), t2: new THREE.Color('#3d9ee0'), h0: new THREE.Color('#1a2a55'), h1: new THREE.Color('#ff9a6a'), h2: new THREE.Color('#c6eaff'), tmp: new THREE.Color() }; // sky and fog colours, reused every frame
function updateEnv(dt) {
  G.sunH = Math.sin(G.dayT * TAU); G.night = 1 - smooth(-0.25, 0.12, G.sunH); const day = 1 - G.night;
  const cy = camera.position.y, dep = Math.max(0, -cy), cv = 0.25 + 0.75 * smooth(0, 0.7, G.clean);
  skyTop.copy(EC.t0).lerp(EC.t1, smooth(-0.3, 0.05, G.sunH)).lerp(EC.t2, smooth(0.05, 0.4, G.sunH));
  skyHor.copy(EC.h0).lerp(EC.h1, smooth(-0.3, 0.05, G.sunH)).lerp(EC.h2, smooth(0.05, 0.4, G.sunH));
  const sunDir = tv1.set(Math.cos(G.dayT * TAU) * 0.6, G.sunH, 0.35).normalize();
  sky.material.uniforms.uTop.value.copy(skyTop); sky.material.uniforms.uHor.value.copy(skyHor); sky.material.uniforms.uSun.value.copy(sunDir); sky.material.uniforms.uNight.value = G.night;
  sun.position.copy(sunDir).multiplyScalar(400).add(camera.position); sun.target.position.copy(camera.position);
  if (cy > 0) { fogCol.copy(skyHor); scene.fog.density = 0.0009; sky.visible = true; hemi.intensity = 0.3 + 1.2 * day; sun.intensity = 2.4 * day * smooth(-0.05, 0.2, G.sunH); U.caust.value = 0; }
  else { fogCol.set(palAt(FOG_MURK, dep)).lerp(EC.tmp.set(palAt(FOG_CLEAN, dep)), cv).multiplyScalar(1 - G.night * 0.72 * (1 - smooth(0, 300, dep)));
    scene.fog.density = lerp(0.0078, 0.0105, smooth(0, 300, dep)) * lerp(1.3, 0.85, cv); sky.visible = false;
    hemi.intensity = lerp(1.35, 0.22, smooth(0, 330, dep)) * (0.35 + 0.65 * day); sun.intensity = 2.2 * Math.exp(-dep / 55) * day * smooth(-0.05, 0.2, G.sunH); U.caust.value = day * smooth(-0.05, 0.25, G.sunH); }
  hemi.color.set(cy > 0 ? '#bfe6ff' : '#8fd6ff'); hemi.groundColor.set(cy > 0 ? '#50606a' : '#1a2e38');
  scene.fog.color.copy(fogCol); if (cy <= 0) scene.background = fogCol; else scene.background = skyHor;
  amb.intensity = 0.05 + (1 - smooth(0, 400, dep)) * 0.05;
  const wu = water.material.uniforms; wu.uCam.value.copy(camera.position); wu.uFogC.value.copy(fogCol); wu.uFogD.value = cy > 0 ? 0.0009 : scene.fog.density; wu.uNight.value = G.night; wu.uSky.value.copy(skyHor).lerp(skyTop, 0.3); wu.uDeep.value.set('#0b4f78').multiplyScalar(0.4 + 0.6 * day); wu.uSun.value.copy(sunDir);
  snow.visible = cy < 0.2; // marine snow only below the waterline
  // distance culling: reef growth only near the shelf reefs, glowing corals only in the deep
  { const reef = Math.hypot(camera.position.x - 90, camera.position.z - 30) < 560 && cy > -260; for (const m of flora.reefMeshes) m.visible = reef; for (const m of flora.deepMeshes) m.visible = cy < -140; }
  for (const f of pieces.far) f.o.visible = (camera.position.x - f.x) ** 2 + (camera.position.z - f.z) ** 2 < 420 * 420;
  const su = snow.material.uniforms; su.uCam.value.copy(camera.position); su.uLP.value.copy(P.nose); su.uLD.value.copy(P.fwd); su.uLR.value = S.light || 50; su.uAmb.value = hemi.intensity * 0.5 + 0.1; su.uPR.value = renderer.getPixelRatio();
  // god rays follow the camera near the surface
  const ra = rays.userData; ra.mat.opacity = 0.05 * day * (1 - smooth(10, 140, dep)) * (0.6 + 0.4 * cv); rays.visible = ra.mat.opacity > 0.003 && cy < 0;
  if (rays.visible) for (const m of ra.rays) { const u = m.userData; m.position.set(Math.round(camera.position.x / 40) * 40 + u.ox, 0, Math.round(camera.position.z / 40) * 40 + u.oz); m.rotation.set(u.tilt + sunDir.x * 0.2, Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z), 0); m.scale.x = 0.7 + 0.3 * Math.sin(G.t * 0.4 + u.ph); }
  const shallow = 1 - smooth(0, 60, dep); lightCone.material.uniforms.uA.value = P.alive ? (0.01 + 0.12 * (1 - shallow * 0.95)) * (inCockpit() ? 0.45 : 1) : 0; lightCone.scale.set(S.light * 0.42 * 0.55, S.light * 0.42 * 0.55, S.light * 0.55);
  SUB.spot.intensity = P.alive ? (90 + SV.up.light * 35) * SPOT_K * lerp(0.25, 1, smooth(10, 120, dep)) * (P.bat < S.bat * 0.08 ? rnd(0.3, 1) : 1) : 0; SUB.lamps.visible = P.alive;
  // glow light pool: nearest emissive sources
  for (const v of pieces.vents) addGlow(tv2.set(v.x, v.top + 1, v.z), 0xff7a2a, 14);
  G.glowSrc.sort((a, b) => a[0].distanceToSquared(camera.position) - b[0].distanceToSquared(camera.position));
  for (let i = 0; i < glowLights.length; i++) { const L = glowLights[i], s = G.glowSrc[i]; if (s && s[0].distanceTo(camera.position) < 120) { L.position.copy(s[0]); L.color.setHex(s[1]); L.intensity = s[2]; L.distance = s[2] > 10 ? 40 : 16; } else L.intensity = 0; }
  G.glowSrc.length = 0;
  sky.position.copy(camera.position);
  const dr = dockRing.userData.ring; dr.material.opacity = 0.6 + 0.3 * Math.sin(G.t * 3); dockRing.visible = G.state !== 'title';
  ship.position.y = 0.9 + Math.sin(G.t * 0.8) * 0.25; ship.rotation.z = Math.sin(G.t * 0.6) * 0.015; ship.rotation.x = Math.sin(G.t * 0.5) * 0.01;
  Music.zone = dep < 60 ? 0 : dep < 220 ? 1 : dep < 500 ? 2 : 3;
}

// =====================================================================
// OVERLAY (2D): edge arrows, markers, floating text
// =====================================================================
function project(p, out) { out.copy(p).project(camera); const behind = tv3.subVectors(p, camera.position).dot(camera.getWorldDirection(tv2)) < 0; return { x: G.vp.x + (out.x * 0.5 + 0.5) * G.vp.w, y: G.vp.y + (-out.y * 0.5 + 0.5) * G.vp.h, behind }; }
const pv = new V3();
function drawOverlay() {
  const c = octx, W = G.VW, H = G.VH; c.setTransform(renderer.getPixelRatio(), 0, 0, renderer.getPixelRatio(), 0, 0); c.clearRect(0, 0, W, H);
  if (G.state === 'title') return;
  c.save(); drawOverlayIn(c, W, H); c.restore();
}
function drawOverlayIn(c, W, H) {
  const ck = inCockpit() && G.ck; if (ck) { const g = ck.glass; c.beginPath(); c.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0); c.clip(); }
  c.textAlign = 'center';
  // revealed items
  for (const it of items) { if (it.col || it.locked || it.rev < G.t) continue; const d = it.pos.distanceTo(camera.position); if (d > 260) continue; const s = project(it.pos, pv); if (s.behind || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) continue;
    const f = Math.min(1, (it.rev - G.t) / 2), p = 0.5 + 0.5 * Math.sin(G.t * 5 + it.ph), r = clamp(260 / d, 6, 26) + p * 3; c.strokeStyle = `rgba(232,146,90,${0.75 * f})`; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.stroke(); }
  // rescues
  for (const r of rescues) { if (r.freed) continue; const d = r.pos.distanceTo(camera.position); if (d > 120) continue; const s = project(r.pos, pv); if (s.behind) continue; const p = 0.5 + 0.5 * Math.sin(G.t * 4); const R = clamp(900 / d, 20, 90);
    c.strokeStyle = `rgba(224,122,168,${0.35 + 0.35 * p})`; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, R, 0, TAU); c.stroke();
    if (r.prog > 0) { c.strokeStyle = '#8fcf9b'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * r.prog); c.stroke(); }
    c.font = '600 12px sans-serif'; c.fillStyle = '#f2d4e2'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.7)'; const t = r.cutting ? `그물 절단 ${Math.floor(r.prog * 100)}%` : '구조 필요 · 빔으로 그물 절단'; c.strokeText(t, s.x, s.y - R - 10); c.fillText(t, s.x, s.y - R - 10); }
  // dock label
  { const d = DOCK.distanceTo(camera.position); if (d < 140) { const s = project(DOCK, pv); if (!s.behind) { c.font = '600 12px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.7)'; c.fillStyle = '#cfe9d4'; const dl = G.story ? '배 · 재활용' : '도킹 · 판매 · 업그레이드'; c.strokeText(dl, s.x, s.y + 34); c.fillText(dl, s.x, s.y + 34); } } }
  // floating texts
  for (const f of ftexts) { const s = project(f.p, pv); if (s.behind) continue; c.globalAlpha = Math.min(1, (f.life / f.max) * 2); c.font = `600 ${f.size}px ui-monospace, Menlo, monospace`; c.lineWidth = 3; c.strokeStyle = 'rgba(0,10,20,.85)'; c.strokeText(f.txt, s.x, s.y); c.fillStyle = f.col; c.fillText(f.txt, s.x, s.y); } c.globalAlpha = 1;
  // edge arrows
  if (G.state !== 'play') return;
  const T = []; const mt = G.guide && G.guide.p; if (mt) T.push({ p: mt, col: '#e9c46a', label: `임무 · ${G.guide.label}`, big: true });
  if ((P.bat < S.bat * 0.3 || P.kg >= S.cargo * 0.92) && !(mt && mt.distanceTo(DOCK) < 1)) T.push({ p: DOCK, col: '#8fcf9b', label: '기지선', big: true });
  const near = []; for (const it of items) { if (it.col || it.locked || it.rev < G.t) continue; near.push([it.pos.distanceToSquared(P.pos), it]); } near.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(5, near.length); i++) T.push({ p: near[i][1].pos, col: '#e8925a' });
  const R = G.win || { x: 12, y: 12, w: W - 24, h: H - 24 }, pad = 22, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  for (const t of T) { const s = project(t.p, pv); let sx = s.x, sy = s.y; const on = !s.behind && sx > R.x + pad && sx < R.x + R.w - pad && sy > R.y + pad && sy < R.y + R.h - pad;
    const dm = Math.round(t.p.distanceTo(P.pos));
    if (on) { if (t.big) { const b = Math.sin(G.t * 4) * 5; c.fillStyle = t.col; c.beginPath(); c.moveTo(sx, sy - 16 + b); c.lineTo(sx - 9, sy - 32 + b); c.lineTo(sx + 9, sy - 32 + b); c.closePath(); c.fill(); c.font = '600 12px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,10,20,.85)'; c.strokeText(`${t.label} ${dm}m`, sx, sy - 38 + b); c.fillText(`${t.label} ${dm}m`, sx, sy - 38 + b); } continue; }
    if (s.behind) { sx = W - sx; sy = H - sy; }
    let dx = sx - cx, dy = sy - cy; if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1; const k = Math.min((R.w / 2 - pad) / Math.max(1e-6, Math.abs(dx)), (R.h / 2 - pad) / Math.max(1e-6, Math.abs(dy)));
    const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx);
    c.save(); c.translate(ax, ay); c.rotate(ang); c.globalAlpha = t.big ? 0.95 : 0.55; c.fillStyle = t.col; const sz = t.big ? 12 : 7; c.beginPath(); c.moveTo(sz, 0); c.lineTo(-sz * 0.8, -sz * 0.75); c.lineTo(-sz * 0.4, 0); c.lineTo(-sz * 0.8, sz * 0.75); c.closePath(); c.fill(); c.restore(); c.globalAlpha = 1;
    if (t.big) { const lx = ax - Math.cos(ang) * 36, ly = ay - Math.sin(ang) * 26; c.font = '600 12px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,10,20,.85)'; const txt = `${t.label} ${dm}m`; c.strokeText(txt, lx, ly + 4); c.fillStyle = t.col; c.fillText(txt, lx, ly + 4); } }
  // 푸른이's speech bubble above its head while the child plays
  if (G.story && !G.talk && BUDDY.model && BUDDY.model.root.visible) { const txt = buddySay(); if (txt) { const s = project(BV[5].copy(BUDDY.pos).add(tv1.set(0, 1.5, 0)), pv);
    if (!s.behind && s.x > 0 && s.x < W && s.y > 0 && s.y < H) { c.font = '700 15px sans-serif'; const w = c.measureText(txt).width + 24, h = 32, x = clamp(s.x - w / 2, 8, W - w - 8), y = s.y - h - 10;
      c.fillStyle = 'rgba(255,255,255,.94)'; c.strokeStyle = '#3fbfa8'; c.lineWidth = 2; c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h); c.fill(); c.stroke(); // roundRect is missing on older iPads
      c.beginPath(); c.moveTo(s.x - 7, y + h - 1); c.lineTo(s.x, y + h + 9); c.lineTo(s.x + 7, y + h - 1); c.closePath(); c.fill();
      c.fillStyle = '#0b2a33'; c.textAlign = 'center'; c.fillText(txt, x + w / 2, y + 21); } } }
}

// =====================================================================
// VIEW MODE (first / third person) + COCKPIT
// =====================================================================
const inCockpit = () => G.fp && G.state !== 'title';
const CK = new CockpitUI($('ckdyn'));
function redrawCockpit() { if (!inCockpit() || !G.ck) return; drawCockpit($('cockpit'), G.ck, Math.min(devicePixelRatio || 1, 2), G.fpTier < 0 ? 0 : G.fpTier); }
// HUD lives inside the visible viewport: the canopy glass above the instrument row in first person, the screen in third person
function layoutHUD() {
  const st = document.documentElement.style, W = G.VW, H = G.VH, ins = 12; let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (inCockpit() && G.ck) ({ x0, y0, x1, y1 } = G.ck.glass);
  st.setProperty('--hx', `${x0 + ins}px`); st.setProperty('--hy', `${y0 + ins}px`); st.setProperty('--hr', `${W - x1 + ins}px`); st.setProperty('--hb', `${H - y1 + ins}px`);
  st.setProperty('--ppy', inCockpit() && G.ck ? `${G.ck.ppY}px` : '50%');
  // touch buttons sit in the bottom-right corner (beside the right stick on tablets), inside the screen edge otherwise
  st.setProperty('--tr', inCockpit() && G.ck ? `${G.ck.touchR}px` : `${W - x1 + ins}px`); st.setProperty('--tb', inCockpit() ? '12px' : `${H - y1 + ins}px`);
  G.win = { x: x0 + ins, y: y0 + ins, w: x1 - x0 - ins * 2, h: y1 - y0 - ins * 2 };
}
function applyView() {
  const on = inCockpit();
  for (const ch of SUB.root.children) if (ch.isMesh && ch !== lightCone) ch.visible = !on;
  document.body.classList.toggle('fp', on); $('cockpit').classList.toggle('hidden', !on); $('ckdyn').classList.toggle('hidden', !on);
  G.fpTier = -1; resize();
}
function toggleView() { if (G.state !== 'play') return; G.fp = !G.fp; applyView(); saveSettings(); $('sView').value = G.fp ? '1' : '0'; AU.click(); updateCamera(1); toast(G.fp ? '1인칭 조종석 시점' : '3인칭 추적 시점', '', 'V 키로 전환합니다.'); }
function cycleCam() { if (!inCockpit() || !G.ck || !G.ck.q.scrR) return; FEED.mode = 1 - FEED.mode; AU.click(); }
// ---- external camera monitor: each update renders a hull camera into the corner of the WebGL canvas
// just before the main pass overwrites it, and copies that corner onto the monitor's 2D canvas.
const FEED = { mode: 0, ok: false, n: 0, q: null, w: 0, h: 0, cam: new THREE.PerspectiveCamera(64, 1.45, 0.3, 480) };
function feedLayout() {
  const q = FEED.q = inCockpit() && G.ck ? G.ck.q.scrR || null : null; if (!q) return;
  FEED.cam.aspect = q.w / q.h; FEED.cam.updateProjectionMatrix();
  const s = Math.min(1, (G.vp.w - 2) / q.w, (G.vp.h - 2) / q.h, 360 / q.w); FEED.w = Math.max(16, Math.floor(q.w * s)); FEED.h = Math.max(9, Math.floor(q.h * s));
}
function renderFeed() {
  if (!FEED.q) return;
  FEED.ok = G.quality > (PHONE ? 1 : 0) && P.alive;
  if (!FEED.ok || FEED.n++ % (G.quality >= 3 ? 1 : G.quality === 2 ? 2 : 3) !== 0) return;
  const cam = FEED.cam; SUB.root.updateMatrixWorld();
  if (FEED.mode === 0) { cam.position.set(0, -0.6, 1.9).applyMatrix4(SUB.root.matrixWorld); cam.rotation.set(P.pitch - 0.62, P.yaw + Math.PI, 0, 'YXZ'); }
  else { cam.position.set(0, 0.7, -3.4).applyMatrix4(SUB.root.matrixWorld); cam.rotation.set(-0.16 - P.pitch * 0.5, P.yaw, 0, 'YXZ'); }
  const lc = lightCone.visible, bc = beamCone.visible; lightCone.visible = false; beamCone.visible = false;
  renderer.setRenderTarget(null); renderer.setViewport(0, 0, FEED.w, FEED.h); renderer.setScissor(0, 0, FEED.w, FEED.h); renderer.setScissorTest(true);
  renderer.render(scene, cam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, G.vp.w, G.vp.h);
  lightCone.visible = lc; beamCone.visible = bc;
  const pr = renderer.getPixelRatio(); CK.feed(canvas, Math.round(FEED.w * pr), Math.round(FEED.h * pr));
}
const CKS = { stickL: [0, 0], stickR: [0, 0], inp: { f: 0, s: 0, u: 0 } };
function cockpitState() {
  const s = CKS, dm = depthOf(P.pos.y), inp = P.inp || s.inp;
  s.t = G.t; s.clock = ST().time; s.depth = dm; s.limit = S.depth; s.speed = P.vel.length(); s.vmax = S.speed * 1.55; s.yaw = P.yaw; s.pos = P.pos;
  s.bat = P.bat / S.bat; s.hull = P.hull / S.hull; s.kg = P.kg; s.cargo = S.cargo; s.money = SV.money; s.alive = P.alive; s.beam = P.beam; s.boost = !!P.boost;
  s.sonarCd = G.sonarCd; s.sonarRange = 50 + SV.up.sonar * 10; s.navRange = 150 + SV.up.sonar * 20; s.beamRange = S.beam; s.alert = G.alert;
  s.items = items; s.rescues = rescues; s.creatures = creatures; s.dock = DOCK; s.target = G.guide ? G.guide.p : null; s.heightAt = heightAt;
  s.cam = FEED.mode; s.camOn = FEED.ok; s.inp = inp;
  s.sys = !P.alive || P.hull < S.hull * 0.3 || dm > S.depth || P.bat < S.bat * 0.1 ? 'bad' : P.hull < S.hull * 0.6 || dm > S.depth * 0.9 || P.bat < S.bat * 0.25 ? 'warn' : 'ok';
  s.stickL[0] = clamp(inp.s, -1, 1); s.stickL[1] = clamp(inp.f, -1, 1); s.stickR[0] = clamp((P.yr || 0) / 2.5, -1, 1); s.stickR[1] = clamp(-inp.u, -1, 1);
  return s;
}

// =====================================================================
// UI
// =====================================================================
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function toast(msg, cls = '', sub = '') { const box = $('toasts'); const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = esc(msg) + (sub ? `<small>${esc(sub)}</small>` : ''); box.appendChild(el);
  const life = cls === 'big' ? 4500 : cls === 'tip' ? 6500 : 3200; setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, life); while (box.children.length > 4) box.firstChild.remove(); }
function tip(id, msg) { if (!SV || SV.tips[id]) return; SV.tips[id] = 1; toast(msg, 'tip'); }
function switchTab(group, id) { const bar = document.querySelector(`.tabs[data-group="${group}"]`); bar.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); $(b.dataset.tab).classList.toggle('hidden', !on); }); }
document.querySelectorAll('.tabs').forEach((bar) => bar.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (!b) return; AU.click(); switchTab(bar.dataset.group, b.dataset.tab); if (b.dataset.tab === 'cxLife') $('cdetail').innerHTML = ''; }));
function renderUpgrades() { $('dMoney').textContent = fmt(SV.money);
  $('ugrid').innerHTML = UP_ORDER.map((k) => { const u = UP[k], lv = SV.up[k], max = lv >= u.c.length, cost = u.c[lv];
    return `<div class="urow"><div><h4>${u.n}</h4><p>${u.d}</p></div><div class="pips">${u.c.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div><div class="uv">${max ? `<b>${u.f(u.v[lv])}</b>` : `${u.v[lv]} → <b>${u.f(u.v[lv + 1])}</b>`}</div>
    <button class="btn small ${max ? '' : 'buy'}" data-buy="${k}" ${max || SV.money < cost ? 'disabled' : ''}>${max ? '최대' : fmt(cost)}</button></div>`; }).join(''); }
$('ugrid').addEventListener('click', (e) => { const b = e.target.closest('[data-buy]'); if (b && !b.disabled) buyUpgrade(b.dataset.buy); });
function renderStats(el) { const s = ST(), t = Math.floor(s.time);
  const rows = [['수거한 쓰레기', `${fmt(s.collected)}개`], ['수거 무게', `${fmt(s.kg)}kg`], ['총 수익', fmt(s.earned)], ['바다 정화율', `${cleanPct()}%`], ['구조한 생물', `${s.rescues} / ${rescues.length}`], ['발견한 생물', `${Object.keys(SV.species).length} / ${SPECIES_ORDER.length}`],
    ['발견한 장소', `${Object.keys(SV.pois).length} / ${POIS.length}`], ['최대 수심', `${fmt(s.deepest)}m`], ['이동 거리', `${(s.dist / 1000).toFixed(1)}km`], ['긴급 구조', `${s.fails}회`], ['플레이 시간', `${Math.floor(t / 3600)}시간 ${Math.floor(t / 60) % 60}분`]];
  el.innerHTML = `<div class="stats">${rows.map((r) => `<div class="stat"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>`; }
// codex thumbnails via a small secondary renderer
let TR = null; const THUMBS = {};
function thumbFor(sp) { if (THUMBS[sp]) return THUMBS[sp];
  if (!TR) { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 184; TR = { r: new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }), scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(35, 320 / 184, 0.05, 200) };
    TR.r.toneMapping = THREE.ACESFilmicToneMapping; TR.r.outputColorSpace = THREE.SRGBColorSpace; TR.scene.add(new THREE.HemisphereLight(0xcff0ff, 0x223344, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); TR.scene.add(dl); }
  let obj;
  if (['sardine', 'lantern', 'clownfish', 'tang'].includes(sp)) { obj = new THREE.Group(); const g = fishGeo(sp); const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }); const n = sp === 'sardine' || sp === 'lantern' ? 3 : 1; for (let i = 0; i < n; i++) { const f = new THREE.Mesh(g, m); f.position.set(i * 0.25 - 0.25, (i % 2) * 0.12, -i * 0.3); obj.add(f); } obj.rotation.y = -Math.PI / 2 + 0.3; }
  else if (sp === 'tubeworm') { obj = new THREE.Group(); for (let i = 0; i < 7; i++) { const w = new THREE.Mesh(M_worm(), new THREE.MeshStandardMaterial({ vertexColors: true })); w.position.set((i - 3) * 0.3, 0, (i % 2) * 0.3); w.scale.setScalar(0.8 + (i % 3) * 0.3); obj.add(w); } }
  else { obj = BUILD[sp]({ hue: 300, col: '#c0553a' }).root; obj.rotation.y = sp === 'crab' ? 0.4 : -Math.PI / 2 + 0.45; if (sp === 'jelly' || sp === 'seahorse' || sp === 'dumbo') obj.rotation.y = 0.3; }
  TR.scene.add(obj); const box = new THREE.Box3().setFromObject(obj); const ctr = box.getCenter(new V3()), size = box.getSize(new V3()).length();
  TR.cam.position.copy(ctr).add(new V3(0, size * 0.15, size * 1.35)); TR.cam.lookAt(ctr); TR.r.setClearColor(0x000000, 0); TR.r.render(TR.scene, TR.cam);
  const url = TR.r.domElement.toDataURL(); TR.scene.remove(obj); THUMBS[sp] = url; return url; }
function M_worm() { const g = new THREE.CylinderGeometry(0.05, 0.06, 1, 6).translate(0, 0.5, 0).toNonIndexed(); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.9), 3)); return g; }
function renderCodex() {
  const found = Object.keys(SV.species).length; $('cxSub').textContent = `발견한 생물 ${found} / ${SPECIES_ORDER.length} · 장소 ${Object.keys(SV.pois).length} / ${POIS.length}`;
  const grid = $('cgrid'); grid.innerHTML = '';
  for (const sp of SPECIES_ORDER) { const has = !!SV.species[sp], d = SPECIES[sp]; const card = document.createElement('div'); card.className = 'ccard' + (has ? '' : ' lock');
    let img = ''; try { img = thumbFor(sp); } catch (e) { img = ''; }
    card.innerHTML = `<div class="thumb">${img ? `<img alt="${esc(d.n)}" src="${img}">` : `<span>${esc(d.n[0])}</span>`}</div><div class="ci"><h5>${has ? esc(d.n) : '???'}</h5><small>${esc(d.hab)}</small></div>`; grid.appendChild(card);
    card.addEventListener('click', () => { AU.click(); $('cdetail').innerHTML = `<div class="cdetail"><h4>${has ? esc(d.n) : '미발견 생물'}</h4><div style="color:var(--muted);font-size:12px;margin-bottom:6px">서식지: ${esc(d.hab)}</div>${has ? esc(d.d) : '아직 발견하지 못했습니다. 서식지를 탐험해 보세요.'}</div>`; }); }
  $('plist').innerHTML = POIS.map((p) => { const has = !!SV.pois[p.id]; return `<div class="pitem ${has ? '' : 'lock'}"><div><h5>${has ? esc(p.n) : '미발견 장소'}</h5><p>${has ? esc(p.d) : `수심 약 ${Math.round(depthOf(p.y) / 50) * 50}m 부근 · 아직 발견하지 못했습니다`}</p></div></div>`; }).join('');
  const s = ST().types; $('tlist').innerHTML = Object.keys(TRASH).map((k) => { const n = s[k] || 0, t = TRASH[k]; return `<div class="pitem ${n ? '' : 'lock'}"><div><h5>${n ? esc(t.n) : '미수거'}${n ? `<span>${t.kg}kg · ${t.v}</span>` : ''}</h5><p>${n ? esc(t.fact) : '아직 수거하지 않은 쓰레기입니다.'}</p></div><div class="cnt">${n}</div></div>`; }).join('');
}
const H = {};
const zoneName = (dm) => (dm < 60 ? '표층' : dm < 220 ? '중층' : dm < 500 ? '심층' : '심해');
function updateHUD() {
  if (!H.ok) { for (const id of ['hMoney', 'hBat', 'hBatV', 'hHull', 'hHullV', 'hCargo', 'hCargoV', 'hDepth', 'hLimit', 'hClean', 'mName', 'mProg', 'mBar', 'mProgRow', 'mDesc', 'mGuide', 'mArrow', 'mGuideTxt', 'mTag', 'hudSite', 'sName', 'sProg', 'sBar', 'sState', 'alert', 'sonarInd', 'sonarTxt', 'rBat', 'rHull', 'rCargo', 'tSonar']) H[id] = $(id); H.ok = true; }
  H.hMoney.textContent = fmt(SV.money);
  H.hBat.style.width = ((P.bat / S.bat) * 100).toFixed(1) + '%'; H.hBatV.textContent = `${Math.round((P.bat / S.bat) * 100)}%`;
  H.hHull.style.width = ((P.hull / S.hull) * 100).toFixed(1) + '%'; H.hHullV.textContent = `${Math.round((P.hull / S.hull) * 100)}%`;
  H.hCargo.style.width = Math.min(100, (P.kg / S.cargo) * 100).toFixed(1) + '%'; H.hCargoV.textContent = `${Math.round(P.kg)}/${S.cargo}`;
  H.rBat.classList.toggle('warn', P.bat < S.bat * 0.25); H.rHull.classList.toggle('warn', P.hull < S.hull * 0.3); H.rCargo.classList.toggle('warn', P.kg >= S.cargo * 0.92);
  const dm = depthOf(P.pos.y); H.hDepth.textContent = Math.floor(dm); H.hDepth.style.color = dm > S.depth ? 'var(--danger)' : dm > S.depth * 0.9 ? 'var(--accent2)' : '';
  H.hLimit.textContent = `한계 ${S.depth}m`;
  H.hClean.textContent = cleanPct().toFixed(1) + '%';
  const m = MISSIONS[SV.mission], sg = G.story && STORY.steps[SS.i];
  H.mTag.textContent = G.story ? '이야기' : '임무';
  if (G.story) { const has = sg && sg.goal; H.mName.textContent = has ? sg.t : STORY.guide.n; H.mDesc.textContent = has ? sg.d : '푸른이의 이야기를 들어 보세요.'; const [c, g] = has ? storyProg(sg) : [0, 1]; H.mProgRow.style.display = has ? '' : 'none'; H.mBar.style.width = (c / g) * 100 + '%'; H.mProg.textContent = has ? `${c}/${g}` : ''; }
  else if (m) { H.mName.textContent = m.t; H.mDesc.textContent = m.d; const [c, g] = mProg(m); H.mProgRow.style.display = ''; H.mBar.style.width = (c / g) * 100 + '%'; H.mProg.textContent = m.poi || m.sp ? (c ? '완료' : '탐색 중') : `${fmt(c)}/${fmt(g)}`; }
  else { H.mName.textContent = '자유 탐험'; H.mDesc.textContent = '남은 쓰레기를 찾아 바다를 끝까지 되살려 보세요.'; H.mProg.textContent = ''; H.mProgRow.style.display = 'none'; }
  // guide: arrow turned by the target's bearing relative to the sub's heading, plus distance and height difference
  const gd = G.guide; H.mGuide.style.display = gd ? '' : 'none';
  if (gd) { const dx = gd.p.x - P.pos.x, dz = gd.p.z - P.pos.z, fwd = dx * Math.sin(P.yaw) + dz * Math.cos(P.yaw), right = -dx * Math.cos(P.yaw) + dz * Math.sin(P.yaw);
    H.mArrow.style.transform = `rotate(${Math.round((Math.atan2(right, fwd) * 180) / Math.PI)}deg)`; const dy = gd.p.y - P.pos.y, dist = Math.round(Math.hypot(dx, dy, dz));
    H.mGuideTxt.textContent = `${gd.label} · ${dist}m${Math.abs(dy) > 8 ? ` ${dy > 0 ? '▲' : '▼'}${Math.round(Math.abs(dy))}m` : ''}`; }
  // cleanup-site panel while the sub is at the wreck or the airliner
  let site = null; for (const st of SITES) if (Math.hypot(P.pos.x - st.c.x, P.pos.z - st.c.z) < st.r + 90) site = st;
  if (G.story) site = null;
  H.hudSite.classList.toggle('hidden', !site);
  if (site) { const done = !!SV.sites[site.id], c = done ? site.total : site.total - site.left; H.hudSite.classList.toggle('done', done); H.sName.textContent = site.n; H.sProg.textContent = `${c}/${site.total}`;
    H.sBar.style.width = (c / site.total) * 100 + '%'; H.sState.textContent = site.valve ? (done ? '정화 완료 · 산호가 색을 되찾는 중' : !SV.valve ? '백화 진행 중 · 뜨거운 폐수 유입' : `수온 회복 중 · 남은 쓰레기 ${site.left}개`) : done ? '정화 완료 · 유출이 멈췄습니다' : `기름 유출 중 · 남은 잔해 ${site.left}개`; }
  if (G.alert) { H.alert.textContent = G.alert; H.alert.classList.add('on'); } else H.alert.classList.remove('on');
  const cd = G.sonarCd > 0; H.sonarInd.classList.toggle('cd', cd); H.sonarTxt.textContent = cd ? `소나 충전 중 ${G.sonarCd.toFixed(1)}s` : '소나 준비 (Q)'; H.tSonar.innerHTML = cd ? `<span>${Math.ceil(G.sonarCd)}</span>` : '소나';
  $('lockHint').classList.toggle('hidden', IN.locked || IN.touch || G.state !== 'play');
  if (inCockpit()) { const tier = P.hull < S.hull * 0.25 ? 2 : P.hull < S.hull * 0.5 ? 1 : 0; if (tier !== G.fpTier) { G.fpTier = tier; redrawCockpit(); } }
  $('dmgVig').style.opacity = P.hull < S.hull * 0.3 ? 0.55 + 0.35 * Math.sin(G.t * 6) : 0; $('flash').style.opacity = G.flash; $('flash').style.background = `rgba(${G.flashCol},1)`;
}
// =====================================================================
// STORY MODE: a guided run of about five minutes for classrooms. Nothing is saved and nothing can fail;
// the guide talks between short goals (pick up trash, free a turtle, heal the bleached reef), then an
// ending card with the results, everyday actions and a three-question OX quiz.
// =====================================================================
const SS = { i: -1, line: 0, base: 0, coralBase: 0, coralDone: false, turtle: null, wait: 0, unloaded: 0 };
const storyCoral = () => SITE.bleach.ids.reduce((n, id) => n + (items[id].col ? 1 : 0), 0) - SS.coralBase;
function storyProg(st) {
  if (st.goal === 'trash') return [Math.min(st.n, ST().collected - SS.base), st.n];
  if (st.goal === 'turtle') return [SS.turtle.freed ? 1 : 0, 1];
  if (st.goal === 'reach') return [Math.hypot(P.pos.x - SITE.bleach.c.x, P.pos.z - SITE.bleach.c.z) < 42 ? 1 : 0, 1];
  if (st.goal === 'valve') return [SV.valve ? 1 : 0, 1];
  if (st.goal === 'coral') return [Math.min(st.n, storyCoral()), st.n];
  if (st.goal === 'dock') return [inDockZone(1.5) ? 1 : 0, 1];
  return [0, 1];
}
function storyGuide(st) {
  if (st.goal === 'trash') { const it = nearestItem(() => true); return it && { p: it.pos, label: '가까운 쓰레기' }; }
  if (st.goal === 'turtle') return { p: SS.turtle.pos, label: '그물에 걸린 바다거북' };
  if (st.goal === 'reach') return { p: SITE.bleach.c, label: '하얀 산호 지대' };
  if (st.goal === 'valve') return { p: bleach.valve.pos, label: '빨간 밸브' };
  if (st.goal === 'coral') { const it = nearestItem((i) => i.site === 'bleach'); return it && { p: it.pos, label: '산호 위 쓰레기' }; }
  if (st.goal === 'dock') return { p: DOCK, label: '배 · 초록색 고리' };
  return null;
}
function storyTick() {
  const st = STORY.steps[SS.i]; G.guide = st && st.goal && !G.talk ? storyGuide(st) : null;
  const h = Math.round(clamp(0.12 + G.clean * 1.15, 0, 1) * 50) / 50; if (h !== G.coralH) { G.coralH = h; flora.setCoralHealth(h); }
  if (!st || !st.goal || G.talk || SS.wait > 0) return;
  const [c, n] = storyProg(st); if (c < n) return;
  SS.wait = 1.3; AU.mission(); BUDDY.party = 1.8; AU.chirp(); toast('잘했어요!', 'good', `${st.t} 완료`);
  if (st.goal === 'coral') { SS.coralDone = true; SV.sites.bleach = 1; } // corals regain full colour and the reef fish come back
  // the hold goes up to the ship for sorting; in story mode the dock has no shop
  if (st.goal === 'dock') { SS.unloaded = P.cargo.length; P.cargo = []; P.kg = 0; recount(); AU.sell(); }
}
// 푸른이 swims with the sub: in front of the glass while talking, ahead toward the goal while the child
// plays (circling the target once it is close), and a loop of joy after each goal.
const BUDDY = { model: null, pos: new V3(), vel: new V3(), q: new THREE.Quaternion(), t: 0, ph: 0, party: 0 }, BV = [new V3(), new V3(), new V3(), new V3(), new V3(), new V3()], ZAX = new V3(0, 0, 1);
function buddyShow() {
  if (!BUDDY.model) { const b = BUILD.dolphin(); b.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set('#9fd0ff'); } });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 18), new THREE.MeshStandardMaterial({ color: '#3fbfa8', emissive: 0x0d3a33, roughness: 0.5 })); collar.position.z = 0.55; collar.scale.x = 0.88; b.root.add(collar); scene.add(b.root); BUDDY.model = b; }
  BUDDY.model.root.visible = true; BUDDY.pos.copy(P.pos).addScaledVector(P.fwd, 9); BUDDY.vel.set(0, 0, 0); BUDDY.party = 0;
}
function buddyHide() { if (BUDDY.model) BUDDY.model.root.visible = false; }
function updateBuddy(dt) {
  const B = BUDDY; if (!B.model) return; const [want, rt, dir, tmp] = BV, f = P.fwd, gd = G.guide; rightOf(P.yaw, rt); B.t += dt;
  let look = null, spd = 14, roll = 0;
  if (G.talk) { want.copy(P.pos).addScaledVector(f, 7).addScaledVector(rt, 1.4); want.y += 0.7 + Math.sin(B.t * 1.6) * 0.25; look = BV[4].copy(P.pos).addScaledVector(rt, 6); } // a three-quarter view, not head-on
  else if (B.party > 0) { B.party -= dt; const a = (1 - B.party / 1.8) * TAU; want.copy(P.pos).addScaledVector(f, 8).addScaledVector(rt, Math.cos(a) * 2.5); want.y += 1 + Math.sin(a) * 2.5; spd = 20; roll = a * 2; }
  else if (gd) { const d = gd.p.distanceTo(P.pos);
    if (d < 14) want.set(gd.p.x + Math.cos(B.t * 0.9) * 5, gd.p.y + 2.5, gd.p.z + Math.sin(B.t * 0.9) * 5);
    else { dir.subVectors(gd.p, P.pos).normalize(); want.copy(P.pos).addScaledVector(dir, Math.min(12, d * 0.5)).addScaledVector(rt, 2.5); want.y += 1.2; }
    spd = Math.max(14, P.vel.length() + 8); }
  else { want.copy(P.pos).addScaledVector(f, 8).addScaledVector(rt, 3); want.y += 1; }
  want.y = clamp(want.y, heightAt(want.x, want.z) + 1.8, -1.2);
  tmp.subVectors(want, B.pos); const dist = tmp.length(); if (dist > 0.01) tmp.multiplyScalar(Math.min(spd, dist * 2) / dist); B.vel.lerp(tmp, 1 - Math.exp(-3 * dt)); B.pos.addScaledVector(B.vel, dt);
  tmp.subVectors(B.pos, P.pos); const sd = tmp.length(); if (sd < 3.5 && sd > 0.01) B.pos.addScaledVector(tmp, (3.5 - sd) / sd); // never inside the sub
  if (look && B.vel.length() < 4) dir.subVectors(look, B.pos); else dir.copy(B.vel); if (dir.lengthSq() > 1e-4) { dir.normalize(); tm.lookAt(dir, ZERO, UPV); tq.setFromRotationMatrix(tm); if (roll) tq.multiply(new THREE.Quaternion().setFromAxisAngle(ZAX, roll)); B.q.slerp(tq, 1 - Math.exp(-5 * dt)); }
  B.model.root.position.copy(B.pos); B.model.root.position.y += Math.sin(B.t * 2) * 0.12; B.model.root.quaternion.copy(B.q); B.ph += dt * (0.6 + Math.min(1.4, B.vel.length() / 8)); B.model.anim(B.ph);
}
function buddySay() { const st = STORY.steps[SS.i]; if (BUDDY.party > 0 || SS.wait > 0) return STORY.hints.cheer; if (!st || !st.goal || !G.guide) return ''; const h = STORY.hints[st.goal]; return h ? h[G.guide.p.distanceTo(P.pos) < 20 ? 1 : 0] : ''; }
// a short beat of game time after each goal before the guide speaks again
function storyUpdate(dt) { if (SS.wait > 0 && (SS.wait -= dt) <= 0) storyStep(SS.i + 1); }
function storyStep(i) {
  SS.i = i; const st = STORY.steps[i];
  if (!st) { storyEnd(); return; }
  if (st.talk) { storyTalk(st.talk); return; }
  SS.base = ST().collected; if (st.goal === 'coral') SS.coralBase = storyCoral() + SS.coralBase;
  toast(`할 일: ${st.t}`, 'tip', st.d); G.tick = 0.29;
}
// dialogue on/off; the touch controls do nothing while it is open, so the page hides them (body.talking)
function setTalk(on) { G.talk = on; document.body.classList.toggle('talking', on); }
function storyTalk(lines) {
  setTalk(true); SS.line = 0; IN.keys = {}; IN.lmb = false; IN.tBeam = IN.tBoost = IN.tUp = IN.tDown = false; unlockPointer();
  $('stDots').innerHTML = lines.map(() => '<i></i>').join(''); show('storyBox'); storyLine();
}
function storyLine() {
  const lines = STORY.steps[SS.i].talk, t = lines[SS.line];
  $('stText').textContent = t === '@controls' ? (IN.touch ? STORY.controls.touch : STORY.controls.keys) : t;
  $('stDots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === SS.line));
  $('stNext').textContent = SS.line < lines.length - 1 ? '다음 ▶' : STORY.steps[SS.i + 1] ? '좋아! ▶' : '끝내기 ▶'; AU.chirp(); SS.lineAt = performance.now();
}
function storyNext() {
  if (!G.talk) return; const lines = STORY.steps[SS.i].talk;
  if (SS.line < lines.length - 1) { SS.line++; storyLine(); return; }
  hide('storyBox'); setTalk(false); const nx = STORY.steps[SS.i + 1]; if (nx && nx.goal) requestLock(); // not before the ending card, which needs the cursor
  storyStep(SS.i + 1);
}
function startStory() {
  AU.init(); hide('storyEnd'); G.story = true; SS.coralDone = false; SS.coralBase = 0; SS.wait = 0; SS.unloaded = 0;
  startGame(null);
  // a comfortable sub for a short lesson: quicker, a longer beam and a roomy hold
  Object.assign(SV.up, { engine: 2, beam: 2, cargo: 3, light: 1 }); calcStats(); P.bat = S.bat; P.hull = S.hull;
  for (const k of ['site_bleach', 'valve', 'net', 'depth', 'drum']) SV.tips[k] = 1; // the guide explains these instead
  SS.turtle = rescues.filter((r) => r.sp === 'turtle').sort((a, b) => a.pos.distanceToSquared(DOCK) - b.pos.distanceToSquared(DOCK))[0];
  document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());
  buddyShow(); storyStep(0);
}
function storyEnd() {
  G.state = 'menu'; setTalk(false); unlockPointer(); hide('storyBox'); AU.mission(); AU.whale(0.18);
  const s = ST(), t = Math.round(s.time), kg = Math.round(s.kg * 10) / 10;
  $('seBody').innerHTML = `<h2>바다를 지켜 줘서 고마워요!</h2><p class="lead">푸른이와 함께 바다를 다시 웃게 만들었어요.</p>
    <div class="sstats"><div><b>${s.collected}개</b><span>주운 쓰레기 (${kg}kg)</span></div><div><b>${s.rescues}마리</b><span>구한 바다거북</span></div><div><b>1곳</b><span>되살린 산호 지대</span></div><div><b>${Math.floor(t / 60)}분 ${t % 60}초</b><span>걸린 시간</span></div></div>
    <h3>우리도 바다를 지킬 수 있어요</h3><ul>${STORY.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    <div class="row"><button class="btn primary" id="seQuiz">OX 퀴즈 풀기</button><button class="btn" id="seHome">처음으로</button></div>`;
  show('storyEnd'); $('seQuiz').onclick = () => storyQuiz(0, 0); $('seHome').onclick = () => { hide('storyEnd'); showTitle(); };
}
function storyQuiz(i, score) {
  const Q = STORY.quiz[i]; AU.click();
  if (!Q) { $('seBody').innerHTML = `<h2>퀴즈 끝!</h2><p class="q">${STORY.quiz.length}문제 중 <b>${score}문제</b>를 맞혔어요.</p><p class="lead">${score === STORY.quiz.length ? '바다 박사님이네요!' : '오늘 배운 것을 친구들에게도 알려 주세요.'}</p>
      <div class="row"><button class="btn primary" id="seAgain">다시 하기</button><button class="btn" id="seHome">처음으로</button></div>`;
    $('seAgain').onclick = () => startStory(); $('seHome').onclick = () => { hide('storyEnd'); showTitle(); }; return; }
  $('seBody').innerHTML = `<h2>OX 퀴즈 ${i + 1}/${STORY.quiz.length}</h2><p class="q">${esc(Q.q)}</p><div class="ox"><button class="ans-o" data-a="1" aria-label="O, 맞아요">O</button><button class="ans-x" data-a="0" aria-label="X, 아니에요">X</button></div><div id="seFb"></div>`;
  $('seBody').querySelectorAll('.ox button').forEach((b) => { b.onclick = () => { const ok = (b.dataset.a === '1') === Q.a; $('seBody').querySelectorAll('.ox button').forEach((x) => { x.disabled = true; x.style.opacity = x === b ? 1 : 0.35; });
    if (ok) AU.mission(); else AU.click();
    $('seFb').innerHTML = `<p class="fb"><b>${ok ? '정답이에요!' : '아쉬워요!'}</b><br>정답은 ${Q.a ? 'O' : 'X'}. ${esc(Q.e)}</p><div class="row"><button class="btn primary" id="seNext">${i + 1 < STORY.quiz.length ? '다음 문제' : '결과 보기'}</button></div>`;
    $('seNext').onclick = () => storyQuiz(i + 1, score + (ok ? 1 : 0)); }; });
}
$('bStory').onclick = () => startStory();
const STORY_LINK = /[?&]story\b/.test(location.search); // class link: ocean-cleanup-3d.html?story (or story.html)
if (STORY_LINK) { $('bStory').classList.add('primary'); $('bNew').classList.remove('primary'); }
$('stNext').onclick = () => storyNext();
// the whole box is a big tap target for small fingers; a second tap within 0.3 s of a new line is ignored so a double tap can't skip it
$('storyBox').addEventListener('click', (e) => { if (!e.target.closest('#stNext') && performance.now() - (SS.lineAt || 0) > 300) storyNext(); });
// ---- flow
let prevState = 'play', modalBack = null;
function openModal(id) { if (G.state !== 'play') return; prevState = G.state; G.state = 'menu'; IN.keys = {}; IN.lmb = false; unlockPointer(); show(id); }
function closeModal(id) { hide(id); if (G.state === 'menu') { G.state = prevState; requestLock(); } }
function openMap() { if (G.state === 'menu' && !$('mapm').classList.contains('hidden')) { closeModal('mapm'); return; } if (G.state !== 'play') return; openModal('mapm'); drawBigMap(); AU.click(); }
function openCodex() { if (G.state === 'menu' && !$('codex').classList.contains('hidden')) { closeModal('codex'); return; } if (G.state !== 'play') return; openModal('codex'); renderCodex(); switchTab('codex', 'cxLife'); $('cdetail').innerHTML = ''; AU.click(); }
function togglePause() { if (G.state === 'play') { G.state = 'pause'; IN.keys = {}; IN.lmb = false; unlockPointer(); show('pause'); saveGame(); AU.click(); } else if (G.state === 'pause') { hide('pause'); G.state = 'play'; requestLock(); AU.click(); } }
function openSub(id, from) { modalBack = from; if (from) hide(from); show(id); AU.click(); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.close; AU.click(); if (id === 'mapm' || id === 'codex') { closeModal(id); return; } hide(id); if (modalBack) { show(modalBack); modalBack = null; } }));
function showTitle() { G.state = 'title'; G.story = false; setTalk(false); hide('storyBox'); hide('storyEnd'); buddyHide(); unlockPointer(); hide('hud'); hide('touch'); ['dock', 'codex', 'mapm', 'pause', 'fail', 'win', 'settings', 'help'].forEach(hide); show('title');
  const d = loadGame(); $('bContinue').classList.toggle('hidden', !d); $('bNew').classList.toggle('primary', !d && !STORY_LINK); SV = freshSave(); calcStats(); resetWorld(); siteTick(true); bleach.valve.prog = 0; bleach.valve.wheel.rotation.y = 0; updateBleach(0, true); G.clean = 0.6; G.coralH = -1; missionTickCoral(); SUB.root.visible = false; applyView(); }
function missionTickCoral() { const h = Math.round(clamp(0.12 + G.clean * 1.15, 0, 1) * 50) / 50; if (h !== G.coralH) { G.coralH = h; flora.setCoralHealth(h); } }
function startGame(d) { AU.init(); applySave(d); hide('title'); show('hud'); if (IN.touch) show('touch'); G.state = 'play'; G.tick = 0; SUB.root.visible = true; applyView(); update(1 / 60); updateCamera(1); if (!G.story) requestLock();
  const hint = $('hint'); hint.style.opacity = 1; hint.innerHTML = IN.touch ? '<span>왼쪽 드래그 이동</span><span>오른쪽 드래그 시점</span><span>빔으로 수거·절단</span>' : '<span><kbd>WASD</kbd>이동</span><span><kbd>Space</kbd><kbd>C</kbd>상승·하강</span><span><kbd>클릭</kbd>빔</span><span><kbd>Q</kbd>소나</span><span><kbd>Shift</kbd>가속</span><span><kbd>V</kbd>시점</span><span><kbd>F</kbd>카메라</span><span><kbd>M</kbd>지도</span><span><kbd>Tab</kbd>도감</span>';
  setTimeout(() => { hint.style.opacity = 0; }, 25000);
  if (G.story) { /* the guide does the introductions */ } else if (!d) { setTimeout(() => toast('해양 정화선 푸른바다호', 'big', '바다가 쓰레기로 병들고 있습니다. 잠수정으로 쓰레기를 수거해 주세요.'), 600); setTimeout(() => { const m = MISSIONS[0]; toast(`임무: ${m.t}`, 'tip', m.d); }, 4200); }
  else toast('이어서 탐험을 시작합니다', '', `바다 정화율 ${cleanPct()}%`);
  saveGame(); }
function showWin() { G.state = 'menu'; prevState = 'play'; unlockPointer(); const s = ST(); $('winStats').innerHTML = [['수거한 쓰레기', `${fmt(s.collected)}개`], ['수거 무게', `${fmt(s.kg)}kg`], ['구조한 생물', `${s.rescues}마리`], ['발견한 생물', `${Object.keys(SV.species).length}종`], ['플레이 시간', `${Math.floor(s.time / 60)}분`], ['총 수익', fmt(s.earned)]].map((r) => `<div class="stat"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
  show('win'); AU.mission(); AU.whale(0.18); saveGame(); }
function confirmBox(title, text, yes) { $('cfTitle').textContent = title; $('cfText').textContent = text; show('confirm'); $('cfYes').onclick = () => { hide('confirm'); yes(); }; $('cfNo').onclick = () => { hide('confirm'); AU.click(); }; }
$('bContinue').onclick = () => startGame(loadGame());
$('bNew').onclick = () => { AU.init(); if (loadGame()) confirmBox('새 게임', '저장된 진행 상황이 사라집니다. 새로 시작할까요?', () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } startGame(null); }); else startGame(null); };
$('bHelpT').onclick = () => { AU.init(); openSub('help', 'title'); }; $('bSetT').onclick = () => { AU.init(); openSub('settings', 'title'); };
$('bHelpP').onclick = () => openSub('help', 'pause'); $('bSetP').onclick = () => openSub('settings', 'pause');
$('bResume').onclick = () => togglePause(); $('bQuit').onclick = () => { saveGame(); hide('pause'); showTitle(); };
$('bLaunch').onclick = () => launch(); $('bRespawn').onclick = () => respawn(); $('bWinGo').onclick = () => { hide('win'); G.state = 'play'; requestLock(); };
$('bMap').onclick = () => openMap(); $('bCodex').onclick = () => openCodex(); $('bPause').onclick = () => togglePause();
$('bReset').onclick = () => confirmBox('저장 데이터 삭제', '모든 진행 상황을 삭제합니다. 되돌릴 수 없습니다.', () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } hide('settings'); hide('pause'); modalBack = null; showTitle(); toast('저장 데이터를 삭제했습니다', ''); });
// ---- settings
function loadSettings() { try { const s = JSON.parse(localStorage.getItem(SET_KEY) || '{}'); if (s.master != null) AU.vol.master = s.master; if (s.music != null) AU.vol.music = s.music; if (s.sfx != null) AU.vol.sfx = s.sfx; if (s.quality != null) G.qualityPref = s.quality; if (s.shake != null) G.shakeOn = !!s.shake; if (s.sens != null) G.sens = s.sens; if (s.fp != null) G.fp = !!s.fp; } catch (e) { /* ignore */ }
  G.quality = G.qualityPref === 'auto' ? AUTO_START : clamp(+G.qualityPref || 0, 0, 3);
  $('sMaster').value = Math.round(AU.vol.master * 100); $('sMusic').value = Math.round(AU.vol.music * 100); $('sSfx').value = Math.round(AU.vol.sfx * 100); $('sQuality').value = String(G.qualityPref); $('sShake').value = G.shakeOn ? 1 : 0; $('sSens').value = Math.round(G.sens * 100); $('sView').value = G.fp ? '1' : '0'; }
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify({ master: AU.vol.master, music: AU.vol.music, sfx: AU.vol.sfx, quality: G.qualityPref, shake: G.shakeOn ? 1 : 0, sens: G.sens, fp: G.fp ? 1 : 0 })); } catch (e) { /* ignore */ } }
$('sMaster').oninput = (e) => { AU.vol.master = e.target.value / 100; AU.setVol(); saveSettings(); };
$('sMusic').oninput = (e) => { AU.vol.music = e.target.value / 100; AU.setVol(); saveSettings(); };
$('sSfx').oninput = (e) => { AU.vol.sfx = e.target.value / 100; AU.setVol(); saveSettings(); AU.click(); };
$('sQuality').onchange = (e) => { const v = e.target.value; G.qualityPref = v === 'auto' ? 'auto' : +v; G.quality = v === 'auto' ? AUTO_START : +v; Object.assign(AQ, { acc: 0, n: 0, slow: 0, fast: 0, dropped: false }); resize(); saveSettings(); };
$('sShake').onchange = (e) => { G.shakeOn = e.target.value === '1'; saveSettings(); };
$('sSens').oninput = (e) => { G.sens = e.target.value / 100; saveSettings(); };
$('sView').onchange = (e) => { G.fp = e.target.value === '1'; applyView(); saveSettings(); };
$('bView').onclick = () => toggleView();

// =====================================================================
// INPUT LISTENERS
// =====================================================================
function requestLock() { if (IN.touch || G.state !== 'play' || G.talk) return; try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed (e.g. sandboxed iframe) */ } }
function unlockPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ } }
// the browser grants the lock asynchronously: one that lands after the game left play (fail, dock, dialogue) would trap the cursor, so let it go
document.addEventListener('pointerlockchange', () => { const was = IN.locked; IN.locked = document.pointerLockElement === canvas; if (IN.locked && (G.state !== 'play' || G.talk)) { unlockPointer(); return; } if (!IN.locked) { IN.lmb = false; if (was && G.state === 'play' && !G.talk) togglePause(); } });
const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (BLOCK.has(e.code)) e.preventDefault(); AU.init();
  if (G.talk && !e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) { storyNext(); return; }
  IN.keys[e.code] = true; if (e.repeat) return;
  if (G.state === 'play') { if (e.code === 'KeyQ' || e.code === 'KeyR') doSonar(); else if (e.code === 'KeyM') openMap(); else if (e.code === 'Tab' || e.code === 'KeyB') openCodex(); else if (e.code === 'Escape' || e.code === 'KeyP') togglePause(); else if (e.code === 'KeyV') toggleView(); else if (e.code === 'KeyF') cycleCam(); }
  else if (G.state === 'menu') { if (e.code === 'KeyM' && !$('mapm').classList.contains('hidden')) openMap(); else if ((e.code === 'Tab' || e.code === 'KeyB') && !$('codex').classList.contains('hidden')) openCodex(); else if (e.code === 'Escape') { if (!$('mapm').classList.contains('hidden')) closeModal('mapm'); else if (!$('codex').classList.contains('hidden')) closeModal('codex'); else if (!$('win').classList.contains('hidden')) { hide('win'); G.state = 'play'; } } }
  else if (G.state === 'pause') { if (e.code === 'Escape' || e.code === 'KeyP') { if (!$('settings').classList.contains('hidden') || !$('help').classList.contains('hidden')) { hide('settings'); hide('help'); show('pause'); modalBack = null; } else togglePause(); } }
  else if (G.state === 'dock') { if (e.code === 'Enter') launch(); }
  else if (G.state === 'fail') { if (e.code === 'Enter') respawn(); }
});
addEventListener('keyup', (e) => { IN.keys[e.code] = false; });
addEventListener('blur', () => { IN.keys = {}; IN.lmb = false; IN.tBeam = IN.tBoost = IN.tUp = IN.tDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); AU.suspend(); if (G.state === 'play') togglePause(); } else AU.resume(); });
// browsers only let audio restart from a user gesture, and iOS reports 'interrupted' after a tab or app switch: retry on every gesture
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, () => AU.init(), { capture: true, passive: true });
addEventListener('pageshow', () => AU.resume()); addEventListener('focus', () => AU.resume());
canvas.addEventListener('mousedown', (e) => { AU.init(); if (IN.touch || G.state !== 'play') return; if (!IN.locked) { requestLock(); IN.drag = true; IN.lx = e.clientX; IN.ly = e.clientY; if (e.button === 0 && e.shiftKey) IN.lmb = true; return; } if (e.button === 0) IN.lmb = true; else if (e.button === 2) doSonar(); });
// Chromium can report the cursor's whole jump to the lock point as one locked move; no hand moves 400 px in one event, so drop those
addEventListener('mousemove', (e) => { if (IN.locked) { if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; IN.mdx += e.movementX; IN.mdy += e.movementY; } else if (IN.drag) { IN.mdx += e.clientX - IN.lx; IN.mdy += e.clientY - IN.ly; IN.lx = e.clientX; IN.ly = e.clientY; } });
addEventListener('mouseup', (e) => { if (e.button === 0) IN.lmb = false; IN.drag = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function enableTouch() { if (IN.touch) return; IN.touch = true; document.body.classList.add('touch'); if (G.state !== 'title') show('touch'); resize(); }
addEventListener('touchstart', () => { AU.init(); enableTouch(); }, { passive: true });
const jz = $('joyZone'), joy = $('joy'), knob = $('joyKnob'), lz = $('lookZone');
jz.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; IN.joy.on = true; IN.joy.id = t.identifier; IN.joy.ox = t.clientX; IN.joy.oy = t.clientY; IN.joy.dx = IN.joy.dy = 0; joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; joy.classList.add('on'); knob.style.transform = 'translate(0,0)'; }, { passive: false });
jz.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { if (t.identifier !== IN.joy.id) continue; let dx = t.clientX - IN.joy.ox, dy = t.clientY - IN.joy.oy; const d = Math.hypot(dx, dy), R = 56; if (d > R) { dx *= R / d; dy *= R / d; } const m = Math.min(1, d / R), k = m > 0 ? joyCurve(m) / m : 0; IN.joy.dx = (dx / R) * k; IN.joy.dy = (dy / R) * k; knob.style.transform = `translate(${dx}px,${dy}px)`; } }, { passive: false });
const joyEnd = (e) => { for (const t of e.changedTouches) { if (t.identifier !== IN.joy.id) continue; IN.joy.on = false; IN.joy.dx = IN.joy.dy = 0; joy.classList.remove('on'); } };
jz.addEventListener('touchend', joyEnd); jz.addEventListener('touchcancel', joyEnd);
lz.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; IN.look.id = t.identifier; IN.look.x = t.clientX; IN.look.y = t.clientY; }, { passive: false });
lz.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { if (t.identifier !== IN.look.id) continue; IN.mdx += (t.clientX - IN.look.x) * 1.6; IN.mdy += (t.clientY - IN.look.y) * 1.6; IN.look.x = t.clientX; IN.look.y = t.clientY; } }, { passive: false });
const lookEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === IN.look.id) IN.look.id = null; }; lz.addEventListener('touchend', lookEnd); lz.addEventListener('touchcancel', lookEnd);
const holdBtn = (el, key) => { el.addEventListener('touchstart', (e) => { e.preventDefault(); IN[key] = true; el.classList.add('on'); }, { passive: false }); const up = (e) => { e.preventDefault(); IN[key] = false; el.classList.remove('on'); }; el.addEventListener('touchend', up); el.addEventListener('touchcancel', up); };
holdBtn($('tBeam'), 'tBeam'); holdBtn($('tBoost'), 'tBoost'); holdBtn($('tUp'), 'tUp'); holdBtn($('tDown'), 'tDown');
$('tSonar').addEventListener('touchstart', (e) => { e.preventDefault(); doSonar(); }, { passive: false });
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// =====================================================================
// LOOP
// =====================================================================
function resize() { G.VW = innerWidth; G.VH = innerHeight; const q = G.quality; const pr = Math.min(devicePixelRatio || 1, [0.85, 1.25, 1.75, 2][q]);
  const L = G.ck = inCockpit() ? cockpitLayout(G.VW, G.VH, IN.touch) : null, vp = G.vp = L ? L.view : { x: 0, y: 0, w: G.VW, h: G.VH };
  renderer.setPixelRatio(pr); renderer.setSize(vp.w, vp.h, false); Object.assign(canvas.style, { left: vp.x + 'px', top: vp.y + 'px', width: vp.w + 'px', height: vp.h + 'px' });
  composer.setPixelRatio(pr); composer.setSize(vp.w, vp.h); bloom.enabled = q > 0; bloom.strength = q >= 2 ? 0.55 : 0.45; SEABED.value = q > 0 ? 1 : 0;
  let f;
  if (L) { // principal point at the middle of the visible glass; F is the virtual frame height
    const py = L.ppY - vp.y, F = 2 * Math.max(py, vp.h - py); f = Math.max(0.72 * G.VH, 0.42 * G.VW);
    camera.fov = (2 * Math.atan(F / 2 / f) * 180) / Math.PI; camera.aspect = vp.w / F; camera.setViewOffset(vp.w, F, 0, F / 2 - py, vp.w, vp.h);
  } else { camera.clearViewOffset(); camera.fov = 68; camera.aspect = vp.w / vp.h; f = vp.h / (2 * Math.tan((68 * Math.PI) / 360)); }
  camera.updateProjectionMatrix(); overlay.width = Math.round(G.VW * pr); overlay.height = Math.round(G.VH * pr);
  FXA.mat.uniforms.uScale.value = f * pr; FXN.mat.uniforms.uScale.value = f * pr;
  snow.visible = true; flora.grass.visible = q > 0; redrawCockpit(); if (L) CK.setLayout(L, Math.min(devicePixelRatio || 1, 2)); feedLayout(); layoutHUD(); }
addEventListener('resize', resize);
// first touch play: ghost hints over the two drag zones until each has been used for a moment, and a pulsing beam button
const TH = { joy: 0, look: 0, shown: '' };
function updateTouchHints(dt) {
  if (!IN.touch) return;
  if (IN.joy.on && Math.abs(IN.joy.dx) + Math.abs(IN.joy.dy) > 0.15) { TH.joy += dt; if (TH.joy > 1.2) SV.tips.joy = 1; }
  if (IN.look.id != null) { TH.look += dt; if (TH.look > 0.8) SV.tips.look = 1; }
  const live = G.state === 'play' && !G.talk, key = (live && !SV.tips.joy ? 'j' : '') + (live && !SV.tips.look ? 'l' : '') + (live && G.beamNear ? 'b' : '');
  if (key === TH.shown) return; TH.shown = key;
  $('joyHint').classList.toggle('hidden', !key.includes('j')); $('lookHint').classList.toggle('hidden', !key.includes('l')); $('tBeam').classList.toggle('nudge', key.includes('b'));
}
function update(dt) {
  G.dayT = (G.dayT + dt / 600) % 1; G.alert = ''; G.alertPri = 0; ST().time += dt;
  updatePlayer(dt); updateItems(dt); updateSuck(dt); updateTouchHints(dt); updateSites(dt); updateValve(dt); if (G.story) { storyUpdate(dt); updateBuddy(dt); } updateBleach(dt); updateVents(dt); updateRescues(dt); updateSonar(dt); updateHazards(dt);
  for (const c of creatures) updateCreature(c, dt); for (const s of schools) updateSchool(s, dt);
  updateCamera(dt);
  G.shake *= Math.pow(0.02, dt); if (G.shake < 0.01) G.shake = 0; G.flash = Math.max(0, G.flash - dt * 1.4);
  G.tick += dt; if (G.tick >= 0.3) { G.tick = 0; discoveryTick(); missionTick(); }
  G.autosave += dt; if (G.autosave > 20) { G.autosave = 0; saveGame(); }
  if (G.pendingWin > 0) { G.pendingWin -= dt; if (G.pendingWin <= 0 && G.state === 'play') showWin(); }
  // beam visual
  beamCone.visible = P.beam; if (P.beam) { beamCone.position.copy(P.nose); tv1.copy(P.nose).add(P.fwd); beamCone.lookAt(tv1); const R = S.beam, w = Math.tan(0.36 + aimPad()) * R; beamCone.scale.set(w, w, R); beamMat.uniforms.uA.value = 0.22; }
}
const attractPath = (t) => { const x = Math.sin(t * 0.05) * 140 + 60, z = Math.cos(t * 0.04) * 110; return new V3(x, Math.max(-14 + Math.sin(t * 0.09) * 6, heightAt(x, z) + 7), z); }; // keeps clear of the hills
function updateAttract(dt) {
  G.dayT = (G.dayT + dt / 300) % 1;
  const p = attractPath(G.t), q = attractPath(G.t + 3); camera.position.lerp(p, 1 - Math.exp(-dt * 2)); tv1.copy(q); tv1.y -= 6; camera.lookAt(tv1);
  P.pos.copy(camera.position); P.nose.copy(camera.position); fwdOf(0, 0, P.fwd);
  for (const c of creatures) updateCreature(c, dt); for (const s of schools) updateSchool(s, dt);
  for (const it of items) if (it.buoy >= 0 && it.pos.distanceToSquared(camera.position) < 150 * 150) writeItem(it, 1);
}
let last = performance.now(), hudAcc = 0, mmAcc = 0;
// Auto quality: start on 높음 and watch real frame times while playing. Two slow windows in a row
// (under ~40 fps for 4 s) drop a tier for good; a device with headroom (~55+ fps for 6 s, e.g. a recent
// iPad Pro) is raised once to 최고.
// auto quality starts a tier lower on phones (touch-first, short side under 600 css px) and on devices reporting 4 GB of
// memory or less (Chrome only; Safari doesn't say), and phones top out at 2; fast devices still climb from there
const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const AUTO_START = Math.max(0, (PHONE ? 1 : 2) - ((navigator.deviceMemory || 8) <= 4 ? 1 : 0)), AUTO_MAX = PHONE ? 2 : 3;
const AQ = { acc: 0, n: 0, slow: 0, fast: 0, dropped: false };
function autoQuality(ms) {
  if (G.qualityPref !== 'auto' || G.state !== 'play' || document.hidden || !(ms > 0)) return;
  // frames are capped at 1 s; one long hitch can't drop a tier alone, that takes two slow windows in a row
  AQ.acc += Math.min(ms, 1000); AQ.n++; if (AQ.acc < 2000) return;
  const avg = AQ.acc / AQ.n; AQ.acc = 0; AQ.n = 0;
  if (avg > 25 && G.quality > 0) { if (++AQ.slow >= 2) { G.quality--; AQ.slow = 0; AQ.dropped = true; resize(); } } else AQ.slow = 0;
  if (avg < 18 && !AQ.dropped && G.quality < AUTO_MAX) { if (++AQ.fast >= 3) { G.quality++; AQ.fast = 0; resize(); } } else AQ.fast = 0;
}
// Safari may drop the WebGL context under memory pressure. three.js rebuilds its GPU resources when the
// context comes back, so save, pause and say so in the meantime. The context is already gone before the
// event arrives, so frames also ask it directly before rendering.
const GL = renderer.getContext();
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.ctxLost = true; saveGame(); if (G.state === 'play') togglePause(); show('ctxLost'); });
canvas.addEventListener('webglcontextrestored', () => { G.ctxLost = false; hide('ctxLost'); resize(); G.needRender = true; });
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now; autoQuality(dt * 1000); if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 1 / 30);
  try {
    pollGamepad(dt);
    const live = G.state === 'play' || G.state === 'title';
    // the hints follow play state; outside play they are cleared here
    if (G.state !== 'play' && TH.shown) updateTouchHints(0);
    if (live) { G.t += dt; U.time.value = G.t; if (G.state === 'play') update(dt); else updateAttract(dt); FXA.update(dt); FXN.update(dt); for (let i = ftexts.length - 1; i >= 0; i--) { const f = ftexts[i]; f.life -= dt; f.p.y += dt * 1.2; if (f.life <= 0) ftexts.splice(i, 1); } writeFish(); }
    if ((live || G.needRender) && !G.ctxLost && !GL.isContextLost()) { updateEnv(dt); if (inCockpit()) renderFeed(); if (bloom.enabled) composer.render(); else renderer.render(scene, camera); drawOverlay(); G.needRender = false; }
    if (G.state === 'play') { hudAcc += dt; if (hudAcc > 0.08) { hudAcc = 0; updateHUD(); } mmAcc += dt; if (mmAcc > 0.15) { mmAcc = 0; drawMinimap(); } if (inCockpit() && G.ck) CK.update(cockpitState(), dt); }
    if (G.state === 'menu' && !$('mapm').classList.contains('hidden')) { mmAcc += dt; if (mmAcc > 0.3) { mmAcc = 0; drawBigMap(); } }
    AU.update(G.state === 'title' ? 20 : depthOf(P.pos.y), P.vel.length() * 12, G.state === 'play' ? P.thrust : 0, G.state === 'play' && P.beam, G.state === 'play');
  } catch (err) { console.error(err); }
}
// =====================================================================
// BOOT
// =====================================================================
genItems(); genRescues(); genSiteItems(); buildItemMeshes(); genCreatures(); buildMap();
G.poll = items.length;
loadSettings(); resize(); showTitle();
function simulate(sec) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { const dt = 1 / 30; G.t += dt; U.time.value = G.t; if (G.state === 'play') update(dt); FXA.update(dt); FXN.update(dt); } writeFish(); }
window.__game = { AU, IN, SUB, SITES, siteTick, startStory, storyEnd, autoQuality, toggleView, simulate, updateCamera, updateEnv, G, P, S, SV: () => SV, items, creatures, schools, rescues, POIS, DOCK, heightAt, startGame, openDock, launch, doSonar, fail, respawn, saveGame, loadGame, MISSIONS, calcStats, camera, renderer, scene, openMap, openCodex, drawBigMap };
$('loading').classList.add('hidden');
requestAnimationFrame((t) => { last = t; frame(t); });
