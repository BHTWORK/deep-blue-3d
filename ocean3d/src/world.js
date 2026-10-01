// Terrain, water, sky, decorations, set pieces. Deterministic world generation.
import * as THREE from 'three';
import { TAU, clamp, lerp, smooth, NZ, fbm, seed, rr, rpick, wpick, mixHex } from './util.js';
import { P, M, displace, lathe, vFin, hFin, MAT } from './models.js';
import { POIS } from './data.js';

export const WORLD = { size: 1800, half: 900, N: 360 };
const GN = WORLD.N + 1, CELL = WORLD.size / WORLD.N;
export const HGT = new Float32Array(GN * GN);
export const U = { time: { value: 0 }, caust: { value: 1 }, sway: { value: 1 } }; // shared shader uniforms

// ridged multi-octave noise in 0..1: sharp crests along the zero lines of the base noise
function ridged(x, z, oct = 4) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(NZ(x * f + i * 13.7, z * f - i * 7.3)); s += v * v * a; n += a; a *= 0.5; f *= 2.1; } return s / n; }
function segDist(x, z, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1); return [Math.hypot(x - ax - vx * t, z - az - vz * t), t]; }
const CANYONS = [[40, -210, 150, -520, 55, 75], [-160, -200, -400, -430, 50, 65], [230, 150, 470, 260, 44, 55]]; // from the shelf edge down the slope: a, b, width, depth
const SEAMOUNTS = [[-380, -480, 110, 190], [520, 330, 95, 165], [-150, 650, 85, 150]]; // x, z, radius, rise
function heightRaw(x, z) {
  const d = Math.hypot(x, z);
  let h = -36;
  h -= smooth(220, 420, d) * 210;
  h -= smooth(450, 580, d) * 85;
  const w = smooth(500, 680, -x) * (1 - smooth(240, 520, Math.abs(z)));
  const e = smooth(520, 690, x) * (1 - smooth(240, 520, Math.abs(z)));
  h -= w * 530 + e * 320;
  const rough = 0.25 + smooth(150, 500, d);
  h += fbm(x * 0.0055, z * 0.0055, 5) * 30 * rough + NZ(x * 0.035, z * 0.035) * 2.2 * (0.5 + rough);
  h += Math.sin(x * 0.06 + NZ(x * 0.01, z * 0.01) * 4) * 0.7 * (1 - smooth(150, 260, d));
  // relief: hills, dunes, canyons and seamounts, kept calm around the base ship and the wreck sites
  let calm = smooth(25, 75, Math.hypot(x - 3, z + 19));
  for (const p of POIS) if (p.id !== 'patch' && p.id !== 'reef' && p.id !== 'kelp' && p.id !== 'bleach') calm = Math.min(calm, smooth(p.r * 0.35, p.r * 0.9, Math.hypot(x - p.x, z - p.z)));
  const shelf = 1 - smooth(200, 300, d), deepZone = smooth(300, 480, d);
  h += calm * shelf * (fbm(x * 0.011 + 3.1, z * 0.011 - 5.2, 4) * 22 + (ridged(x * 0.02, z * 0.02, 3) - 0.45) * 12);
  h += shelf * 8 * Math.exp(-((x - 150) ** 2 + (z - 20) ** 2) / (2 * 70 * 70)); // the east reef sits on a low plateau
  h += calm * shelf * Math.sin(x * 0.21 + z * 0.08 + NZ(x * 0.02, z * 0.02) * 3) * 1.3 * (0.6 + 0.4 * NZ(x * 0.01 + 9, z * 0.01)); // sand dunes
  for (const [ax, az, bx, bz, cw, cd] of CANYONS) { const [dist, t] = segDist(x, z, ax, az, bx, bz), wob = NZ(x * 0.012 + ax, z * 0.012) * cw * 0.5;
    h -= cd * smooth(0, 0.2, t) * (1 - smooth(cw * 0.3, cw, Math.max(0, dist + wob))); }
  h += calm * deepZone * (ridged(x * 0.007, z * 0.007, 4) - 0.4) * 75;
  for (const [sx, sz, r, rise] of SEAMOUNTS) { const q2 = ((x - sx) ** 2 + (z - sz) ** 2) / (r * r); h += rise * Math.exp(-q2 * 1.6) * (0.85 + 0.3 * NZ(x * 0.03, z * 0.03)); }
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smooth(790, 895, edge) * 520;
  return Math.min(h, -5);
}
// The wreck and the airliner rest on levelled beds cut into the slope. HGT0 keeps the seabed from before
// the beds so item generation, which tests heights, still lays out the same items (saves refer to them by id).
const BEDS = POIS.filter((p) => p.id === 'wreck' || p.id === 'plane' || p.id === 'whalefall');
const HGT0 = new Float32Array(GN * GN);
function sampleGrid(A, x, z) {
  const gx = clamp((x + WORLD.half) / CELL, 0, WORLD.N - 0.001), gz = clamp((z + WORLD.half) / CELL, 0, WORLD.N - 0.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * GN + i;
  return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fz) + (A[k + GN] * (1 - fx) + A[k + GN + 1] * fx) * fz;
}
export const heightAt = (x, z) => sampleGrid(HGT, x, z);
export const heightAt0 = (x, z) => sampleGrid(HGT0, x, z);
export function normalAt(x, z) { const e = 2; return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize(); }

// ---- caustics shader injection (world-space, top-facing surfaces, fades with depth)
const CAUSTIC_GLSL = `
uniform float uTime; uniform float uCaust; varying vec3 vWPos; varying vec3 vWNrm;
float caustic(vec2 uv, float time){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0; vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) { float t = time * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+t)/inten), p.y / (cos(i.y+t)/inten))); }
  c /= 4.0; c = 1.17 - pow(c, 1.4); return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}`;
function setKey(mat, part) { mat.userData.keyParts = (mat.userData.keyParts || []).concat(part); mat.customProgramCacheKey = () => mat.userData.keyParts.join('|'); }
export function addCaustics(mat, strength = 0.6) {
  setKey(mat, 'caust' + strength);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uCaust = U.caust;
    sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWNrm;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cwp = vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        cwp = instanceMatrix * cwp;
      #endif
      vWPos = (modelMatrix * cwp).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = CAUSTIC_GLSL + '\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      { float dep = clamp(-vWPos.y, 0.0, 400.0); float att = exp(-dep*0.02) * uCaust * clamp(vWNrm.y*1.4, 0.0, 1.0);
        if (att > 0.003) { float c = caustic(vWPos.xz*0.045, uTime*0.55) + 0.6*caustic(vWPos.xz*0.07+0.3, uTime*0.4); gl_FragColor.rgb += vec3(0.6,0.85,1.0) * c * att * ${strength.toFixed(2)}; } }`);
  };
  return mat;
}
// ---- seabed detail: sand ripples (as a bump on the lighting) and fine grain/mottling (in the albedo) for the
// close-up seabed the 5 m terrain grid cannot show; fades out with distance to stay free of shimmer. Apply
// after addCaustics, which provides the world position and normal.
export const SEABED = { value: 1 }; // 0 turns the detail off (low quality)
export function addSeabed(mat) {
  setKey(mat, 'seabed');
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uSeabed = SEABED;
    sh.fragmentShader = `uniform float uSeabed;
      float sbHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sbNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(sbHash(i), sbHash(i + vec2(1.0, 0.0)), u.x), mix(sbHash(i + vec2(0.0, 1.0)), sbHash(i + vec2(1.0, 1.0)), u.x), u.y); }
      ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float sbFade = uSeabed * (1.0 - smoothstep(15.0, 55.0, distance(cameraPosition, vWPos)));
      float sbDep = clamp(-vWPos.y, 0.0, 900.0), sbFlat = smoothstep(0.8, 0.96, vWNrm.y);
      float sbRip = sbFade * sbFlat * (1.0 - smoothstep(70.0, 240.0, sbDep)); // ripples on the shallower sand
      float sbTurn = 0.4 + sbNoise(vWPos.xz * 0.045) * 1.6;
      vec2 sbDir = vec2(cos(sbTurn), sin(sbTurn));
      float sbPh = dot(vWPos.xz, sbDir) * 5.4 + sbNoise(vWPos.xz * 0.32) * 3.6 + sbNoise(vWPos.xz * 1.1) * 0.8;
      vec2 sbGrad = sbDir * (5.4 * 0.035 * cos(sbPh) * sbRip);
      float sbGrain = sbNoise(vWPos.xz * 3.3) * 0.6 + sbNoise(vWPos.xz * 10.0) * 0.4, sbMott = sbNoise(vWPos.xz * 0.55);
      diffuseColor.rgb *= 1.0 + ((sbGrain - 0.5) * 0.18 + (sbMott - 0.5) * 0.14) * sbFade + sin(sbPh) * 0.03 * sbRip;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize(normal + (viewMatrix * vec4(-sbGrad.x, 0.0, -sbGrad.y, 0.0)).xyz);`);
  };
  return mat;
}
// ---- vertex sway injection for instanced flora (uses local y as height 0..1)
export function addSway(mat, amp = 1) {
  setKey(mat, 'sway' + amp);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = U.time;
    if (!sh.vertexShader.includes('uniform float uTime')) sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = instanceMatrix[3].x*0.13 + instanceMatrix[3].z*0.17; float hh = max(position.y, 0.0);
        transformed.x += sin(uTime*0.9 + ph + hh*2.5) * hh*hh * ${amp.toFixed(3)};
        transformed.z += cos(uTime*0.7 + ph*1.3 + hh*2.0) * hh*hh * ${(amp * 0.6).toFixed(3)}; }`);
  };
  return mat;
}

// ---------------------------------------------------------------- terrain
export function buildTerrain() {
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) HGT0[j * GN + i] = heightRaw(-WORLD.half + i * CELL, -WORLD.half + j * CELL);
  HGT.set(HGT0);
  for (const b of BEDS) { const lvl = heightRaw(b.x, b.z), R = b.r * 1.3;
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const x = -WORLD.half + i * CELL, z = -WORLD.half + j * CELL, d = Math.hypot(x - b.x, z - b.z); if (d >= R) continue;
      const k = j * GN + i; HGT[k] = lerp(HGT[k], lvl + NZ(x * 0.07 + 3, z * 0.07) * 0.9, 1 - smooth(b.r * 0.45, R, d)); } }
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, WORLD.N, WORLD.N).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), z = pos.getZ(k); pos.setY(k, heightAt(x, z)); }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, cols = new Float32Array(pos.count * 3);
  const sand = new THREE.Color('#dccb9c'), mud = new THREE.Color('#8f7f66'), deep = new THREE.Color('#6c6674'), abyss = new THREE.Color('#4a4656'), rock = new THREE.Color('#756a60'), rockD = new THREE.Color('#4a4652'), c = new THREE.Color(), r = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), dep = -y;
    c.copy(sand).lerp(mud, smooth(40, 200, dep)).lerp(deep, smooth(200, 380, dep)).lerp(abyss, smooth(450, 800, dep));
    r.copy(rock).lerp(rockD, smooth(80, 500, dep));
    const steep = smooth(0.82, 0.55, nrm.getY(k)); c.lerp(r, steep);
    const n = NZ(x * 0.08, z * 0.08) * 0.12 + NZ(x * 0.5, z * 0.5) * 0.05; c.multiplyScalar(1 + n);
    if (x > 60 && x < 250 && Math.abs(z - 20) < 150 && dep < 60) c.lerp(new THREE.Color('#e8cfb4'), 0.25);
    if (x < -60 && x > -250 && Math.abs(z) < 160 && dep < 60) c.lerp(new THREE.Color('#6f7a4a'), 0.2);
    if (Math.hypot(x + 745, z + 120) < 90) c.lerp(new THREE.Color('#3a2620'), 0.4);
    cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = addSeabed(addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }), 0.7));
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = false; mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- water surface & sky
export function buildWater() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: false,
    uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Color('#0b4f78') }, uSky: { value: new THREE.Color('#9fd8ff') }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0.01 }, uNight: { value: 0 }, uSun: { value: new THREE.Vector3(0.3, 0.8, 0.2) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uFogC; uniform float uFogD; uniform float uNight; uniform vec3 uSun; varying vec3 vW;
      float h(vec2 p){ return sin(p.x*0.35+uTime*1.2)*0.5 + sin(p.y*0.27-uTime*0.9)*0.5 + sin((p.x+p.y)*0.6+uTime*1.7)*0.25 + sin((p.x-p.y)*1.3-uTime*2.1)*0.12 + sin(p.x*2.1+p.y*1.7+uTime*3.0)*0.05; }
      void main(){
        vec2 e = vec2(0.25, 0.0);
        vec3 n = normalize(vec3(h(vW.xz-e.xy)-h(vW.xz+e.xy), 1.2, h(vW.xz-e.yx)-h(vW.xz+e.yx)));
        vec3 V = normalize(uCam - vW); float dist = length(uCam - vW); vec3 col;
        if (gl_FrontFacing) {
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          col = mix(uDeep, uSky, 0.04 + 0.6*fres);
          vec3 H = normalize(normalize(uSun) + V); col += pow(max(dot(n, H), 0.0), 160.0) * 2.0 * (1.0 - uNight);
          col = mix(col, uSky, (1.0 - exp(-dist*0.0012))*0.8);
        } else {
          float cv = max(dot(-n, V), 0.0);
          float snell = smoothstep(0.5, 0.8, cv);
          vec3 sky = uSky*0.85 + vec3(0.08)*(1.0-uNight);
          col = mix(uDeep*0.9, sky, snell);
          col += vec3(0.8,0.95,1.0) * pow(max(n.x*n.z*8.0+0.5, 0.0), 12.0) * 0.06 * (1.0 - uNight);
          col = mix(uFogC, col, exp(-dist*uFogD*0.9));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), mat); m.frustumCulled = false; m.renderOrder = -1;
  return m;
}
export function buildSky() {
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color('#3d9ee0') }, uHor: { value: new THREE.Color('#c6eaff') }, uSun: { value: new THREE.Vector3(0.3, 0.8, 0.2) }, uNight: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uNight; varying vec3 vD;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){ float t = clamp(vD.y, 0.0, 1.0); vec3 c = mix(uHor, uTop, pow(t, 0.6));
        float s = max(dot(vD, normalize(uSun)), 0.0); c += vec3(1.0,0.9,0.7) * (pow(s, 600.0)*6.0 + pow(s, 12.0)*0.25) * step(0.0, uSun.y);
        vec3 m = -normalize(uSun); float ms = max(dot(vD, m), 0.0); c += vec3(0.8,0.85,1.0) * pow(ms, 900.0) * 3.0 * uNight;
        vec3 q = floor(vD*300.0); float st = step(0.9985, hash(q)) * uNight * t; c += vec3(st);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat); m.frustumCulled = false; m.renderOrder = -2;
  return m;
}
export function buildSnow(count = 2600) {
  const pos = new Float32Array(count * 3), sz = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos[i * 3] = Math.random() * 120; pos[i * 3 + 1] = Math.random() * 120; pos[i * 3 + 2] = Math.random() * 120; sz[i] = 0.5 + Math.random() * 1.4; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uLP: { value: new THREE.Vector3() }, uLD: { value: new THREE.Vector3(0, 0, 1) }, uLR: { value: 50 }, uAmb: { value: 0.3 }, uPR: { value: 1 } },
    vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uLP; uniform vec3 uLD; uniform float uLR; uniform float uAmb; uniform float uPR; attribute float size; varying float vA;
      void main(){ vec3 p = position + vec3(uTime*0.25, -uTime*0.35, uTime*0.15); p = mod(p - uCam + 60.0, 120.0) - 60.0 + uCam;
        vec3 d = p - uLP; float dl = length(d); float cone = smoothstep(0.82, 0.97, dot(d/dl, uLD)) * (1.0 - smoothstep(uLR*0.5, uLR, dl));
        float fade = 1.0 - smoothstep(25.0, 60.0, length(p - uCam));
        vA = (uAmb*0.35 + cone) * fade * step(p.y, -0.5);
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_PointSize = size * uPR * (40.0 / max(-mv.z, 0.5)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.5,0.1,length(c)); gl_FragColor = vec4(vec3(0.85,0.93,1.0), a*vA*0.8); }' });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; return pts;
}
export function gradTex(stops, w = 4, h = 128, vertical = true) {
  const c = document.createElement('canvas'); c.width = vertical ? w : h; c.height = vertical ? h : w; const x = c.getContext('2d');
  const g = vertical ? x.createLinearGradient(0, 0, 0, h) : x.createLinearGradient(0, 0, h, 0); stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function buildRays() {
  const tc = document.createElement('canvas'); tc.width = 64; tc.height = 256; const tx = tc.getContext('2d');
  const gv = tx.createLinearGradient(0, 0, 0, 256); gv.addColorStop(0, 'rgba(255,250,230,1)'); gv.addColorStop(0.45, 'rgba(255,250,230,.35)'); gv.addColorStop(1, 'rgba(255,250,230,0)'); tx.fillStyle = gv; tx.fillRect(0, 0, 64, 256);
  tx.globalCompositeOperation = 'destination-in'; const gh = tx.createLinearGradient(0, 0, 64, 0); gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)'); tx.fillStyle = gh; tx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group(); const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const rays = [];
  for (let i = 0; i < 16; i++) { const w = 3 + Math.random() * 10, h = 90 + Math.random() * 90; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, -h / 2, 0), mat); m.userData = { ox: (Math.random() - 0.5) * 160, oz: (Math.random() - 0.5) * 160, ph: Math.random() * TAU, tilt: (Math.random() - 0.5) * 0.25 }; g.add(m); rays.push(m); }
  g.userData.rays = rays; g.userData.mat = mat; return g;
}

// ---------------------------------------------------------------- flora
function kelpTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 6; x.beginPath(); x.moveTo(32, 512); x.quadraticCurveTo(28, 256, 32, 0); x.stroke();
  x.fillStyle = '#fff';
  for (let y = 490; y > 10; y -= 22) { const s = y % 44 ? 1 : -1; x.beginPath(); x.ellipse(32 + s * 14, y, 16, 5, s * 0.5, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function surfaceY(x, z) { return heightAt(x, z); }
function placeOn(x, z, sink = 0) { return heightAt(x, z) - sink; }
// reef patches [x0, x1, z0, z1, weight]: the east reef is the main one, smaller ones dot the shelf
const REEF = [[60, 245, -120, 160, 5], [-40, 120, 150, 250, 2], [10, 170, -250, -140, 2], [-60, 30, 40, 120, 1], [180, 280, 170, 260, 1.5], [-240, -120, 160, 240, 1]];
// Reef growth sits in coral heads with open sand between them. Every placed piece registers a
// footprint so corals, anemones, rocks and litter do not pile into one another.
let HEADS = null;
const OCC = new Map(), OCC_CELL = 4;
function occFree(x, z, r) {
  const cx = Math.floor(x / OCC_CELL), cz = Math.floor(z / OCC_CELL), n = Math.ceil((r + 3) / OCC_CELL);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const l = OCC.get(`${cx + i},${cz + j}`); if (l) for (const [px, pz, pr] of l) if ((px - x) ** 2 + (pz - z) ** 2 < (pr + r) ** 2) return false; }
  return true;
}
function occAdd(x, z, r) { const k = `${Math.floor(x / OCC_CELL)},${Math.floor(z / OCC_CELL)}`; if (!OCC.has(k)) OCC.set(k, []); OCC.get(k).push([x, z, r]); }
export const reefFree = occFree;
export function reefPoint(minY = -78) {
  if (!HEADS) { HEADS = []; for (let i = 0; i < 400 && HEADS.length < 70; i++) { const p = wpick(REEF.map((r) => [r, r[4]])), x = rr(p[0], p[1]), z = rr(p[2], p[3]); if (Math.hypot(x - 3, z + 19) < 35) continue; const y = heightAt(x, z); if (y < -75 || y > -5) continue; if (HEADS.some((h) => Math.hypot(h[0] - x, h[1] - z) < 22)) continue; HEADS.push([x, z, rr(5, 10)]); } }
  for (let k = 0; k < 30; k++) {
    const c = HEADS[(SRr() * HEADS.length) | 0], a = rr(0, TAU), d = Math.sqrt(SRr()) * c[2], x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
    const y = heightAt(x, z); if (y < minY || y > -4) continue; return [x, y, z];
  }
  return null;
}
const lcg = (v) => () => (v = (v * 16807) % 2147483647) / 2147483647;
export function buildFlora(scene, colliders) {
  const out = { reefMeshes: [] };
  seed(777);
  // kelp — west shelf
  { const kg = new THREE.PlaneGeometry(1, 1, 1, 12).translate(0, 0.5, 0), kg2 = kg.clone().rotateY(Math.PI / 2);
    const kelpGeo = mergeUV([kg, kg2]);
    const mat = addSway(new THREE.MeshStandardMaterial({ map: kelpTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: '#ffffff' }), 0.9);
    const N = 360; const im = new THREE.InstancedMesh(kelpGeo, mat, N); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let n = 0; for (let i = 0; i < N * 3 && n < N; i++) { const x = rr(-250, -60), z = rr(-170, 150); const y = heightAt(x, z); if (y < -70) continue; const h = rr(14, 32) * (0.6 + 0.4 * smooth(-60, -140, x)); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, TAU));
      m4.compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(rr(2.2, 3.2), h, rr(2.2, 3.2))); im.setMatrixAt(n, m4); c.set(rpick(['#4f7a26', '#6f9a34', '#5b8a2e', '#7ea43c'])); im.setColorAt(n, c); n++; }
    im.count = n; im.frustumCulled = false; scene.add(im); out.kelp = im; }
  // seagrass tufts on shelf
  { const blades = []; for (let b = 0; b < 5; b++) { const a = (b / 5) * TAU; blades.push(P(new THREE.PlaneGeometry(0.12, 1, 1, 3).translate(0, 0.5, 0), '#fff', [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12], [0.1 * Math.cos(a), a, 0.1 * Math.sin(a)], [1, 0.7 + (b % 3) * 0.2, 1])); }
    const geo = M(...blades); const mat = addSway(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), 0.35);
    const N = 3200; const im = new THREE.InstancedMesh(geo, mat, N); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(); let n = 0;
    for (let i = 0; i < N * 2 && n < N; i++) { const a = rr(0, TAU), d = Math.sqrt(SRr()) * 250; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.hypot(x, z + 20) < 12) continue; const y = heightAt(x, z); if (y < -80) continue; const s = rr(0.8, 2.2);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, TAU)); m4.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s * 1.4, s, s * 1.4)); im.setMatrixAt(n, m4); c.set(rpick(['#8fcf6a', '#a6d77a', '#79b85a', '#b8d86a'])); im.setColorAt(n, c); n++; }
    im.count = n; im.frustumCulled = false; scene.add(im); out.grass = im; }
  // corals — reef east
  { const kinds = coralGeos(); out.corals = []; out.coralKinds = kinds;
    const palette = ['#ff5d8f', '#ff8c42', '#b15cff', '#ffd166', '#ef476f', '#2ec4b6', '#c792ea', '#ff6b6b', '#f78fb3'];
    const PAL = { whip: ['#ff5a36', '#ffb000', '#e63946', '#ff7f50', '#c77dff'], bubble: ['#e6f5d0', '#ffd6e8', '#d8f3ff', '#fff3b0'], soft: ['#ff8fab', '#c77dff', '#ffd166', '#ff9e5e', '#9bf6ff', '#f15bb5'] };
    const SCALE = { whip: 1.1, soft: 1.1 }, FOOT = { branch: 0.55, stag: 0.8, brain: 0.7, fan: 0.45, soft: 0.5, bubble: 0.4, whip: 0.35 }; // footprint radius at scale 1
    // instances are bucketed into 200 m cells so the renderer can frustum-cull whole cells
    const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 0.4);
    for (const [name, geo, cnt] of kinds) { const cells = new Map();
      let n = 0; for (let i = 0; i < cnt * 6 && n < cnt; i++) { const pt = reefPoint(); if (!pt) continue; const [x, y, z] = pt; const s = rr(0.8, 2.2) * (SCALE[name] || 1), fr = s * FOOT[name];
        if (!occFree(x, z, fr)) continue; occAdd(x, z, fr);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.15, 0.15), rr(0, TAU), rr(-0.15, 0.15))), key = `${Math.floor(x / 200)},${Math.floor(z / 200)}`;
        if (!cells.has(key)) cells.set(key, []); cells.get(key).push([new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(s, s, s)), new THREE.Color(rpick(PAL[name] || palette))]); n++; }
      for (const list of cells.values()) { const im = new THREE.InstancedMesh(geo, mat, list.length), vivid = [];
        list.forEach(([m4, c], i) => { im.setMatrixAt(i, m4); im.setColorAt(i, c); vivid.push(c); }); im.computeBoundingSphere(); scene.add(im); out.corals.push({ im, vivid }); out.reefMeshes.push(im); } }
    out.setCoralHealth = (h) => { const bl = new THREE.Color('#ece6da'), c = new THREE.Color(); for (const { im, vivid } of out.corals) { for (let i = 0; i < im.count; i++) { c.copy(bl).lerp(vivid[i], h); im.setColorAt(i, c); } im.instanceColor.needsUpdate = true; } };
  }
  // anemones (clownfish homes)
  { const tent = []; for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU * 3, r = 0.08 + (i / 26) * 0.35; tent.push(P(new THREE.CylinderGeometry(0.02, 0.05, 1, 5).translate(0, 0.5, 0), '#fff', [Math.cos(a) * r, 0.2, Math.sin(a) * r], [Math.sin(a) * 0.5 * r * 2, 0, -Math.cos(a) * 0.5 * r * 2], [1, 0.6 + (i % 3) * 0.15, 1], (x, y) => (y > 0.7 ? [1, 1, 1] : [0.85, 0.85, 0.85]))); }
    tent.push(P(new THREE.CylinderGeometry(0.45, 0.5, 0.3, 12), '#b09080', [0, 0.1, 0]));
    const geo = M(...tent); const mat = addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x220011, emissiveIntensity: 0.3 }), 0.25);
    const NA = 26, im = new THREE.InstancedMesh(geo, mat, NA); const m4 = new THREE.Matrix4(); out.anems = []; const vivid = [];
    for (let i = 0; i < NA; i++) { let x, y, z; if (i < 8) { x = 90 + i * 18 + rr(-5, 5); z = rr(-40, 60); y = heightAt(x, z); } else { let pt = null; for (let k = 0; k < 20 && !pt; k++) { const c = reefPoint(-60); if (c && occFree(c[0], c[2], 1.3)) pt = c; } pt = pt || [150, heightAt(150, 20), 20]; [x, y, z] = pt; } occAdd(x, z, 1.3); m4.compose(new THREE.Vector3(x, y - 0.1, z), new THREE.Quaternion(), new THREE.Vector3(2.2, 1.6, 2.2)); im.setMatrixAt(i, m4); vivid.push(new THREE.Color(rpick(['#c04dff', '#ff4f8b', '#ff7a3a', '#6fe0ff']))); im.setColorAt(i, vivid[i]); out.anems.push(new THREE.Vector3(x, y + 1.2, z)); }
    im.frustumCulled = false; scene.add(im); out.corals.push({ im, vivid }); out.reefMeshes.push(im); }
  reefLife(scene, out, colliders);
  // rocks
  { const geos = [0, 1, 2].map((k) => displace(P(new THREE.IcosahedronGeometry(1, 2), '#fff', [0, 0, 0], [0, 0, 0], [1, 0.7 + k * 0.1, 1], (x, y, z) => { const n = NZ(x * 2 + k, z * 2 + y) * 0.5 + 0.5; const v = 0.42 + n * 0.25; return [v * 1.02, v * 0.95, v * 0.9]; }), 0.35, 1.2, k * 3.1));
    const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.6); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    out.rocks = geos.map((g, k) => { const N = 300; const im = new THREE.InstancedMesh(g, mat, N); let n = 0;
      for (let i = 0; i < N * 3 && n < N; i++) { const x = rr(-880, 880), z = rr(-880, 880); const d = Math.hypot(x, z); if (d < 60) continue; const y = heightAt(x, z); const big = SRr() < 0.25; const s = big ? rr(4, 11) : rr(0.8, 3.2);
        if (d < 240 && s > 5) continue; if (Math.hypot(x, z) < 40) continue; if (d < 320 && !occFree(x, z, s * 1.1)) continue;
        q.setFromEuler(new THREE.Euler(rr(0, 1), rr(0, TAU), rr(0, 1))); const sc = new THREE.Vector3(s * rr(0.8, 1.4), s * rr(0.6, 1.1), s * rr(0.8, 1.4));
        m4.compose(new THREE.Vector3(x, y + s * 0.15, z), q, sc); im.setMatrixAt(n, m4); const tint = new THREE.Color().setScalar(1).lerp(new THREE.Color('#5a5666'), smooth(40, 600, -y)); im.setColorAt(n, tint); n++;
        if (s > 2.2) colliders.push({ x, y: y + s * 0.3, z, r: Math.min(sc.x, sc.y, sc.z) * 0.9 }); }
      im.count = n; im.frustumCulled = false; scene.add(im); return im; }); }
  // rock arches on the plains
  { const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.5);
    for (const [x, z, rot, R] of [[-420, -260, 0.4, 26], [230, 470, 1.2, 22], [520, -120, 2.2, 30], [-300, 520, 0.9, 20]]) {
      const geo = displace(P(new THREE.TorusGeometry(R, R * 0.22, 10, 28, Math.PI), '#6a6068', [0, 0, 0], [0, 0, 0], [1, 1, 0.8], (a, b, c) => { const v = 0.35 + (NZ(a * 0.2, b * 0.2 + c) * 0.5 + 0.5) * 0.2; return [v, v * 0.95, v * 1.02]; }), R * 0.08, 0.15, x);
      const y = heightAt(x, z); const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y - R * 0.12, z); mesh.rotation.y = rot; scene.add(mesh);
      for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI; const lx = Math.cos(a) * R, ly = Math.sin(a) * R; colliders.push({ x: x + lx * Math.cos(rot), y: y - R * 0.12 + ly, z: z - lx * Math.sin(rot), r: R * 0.24 }); }
    } }
  return out;
}
let SRr = () => rr(0, 1);
// starfish and urchins on the sand, bioluminescent corals in the deep
function reefLife(scene, out, colliders) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const shelfPoint = (maxD, minY) => { for (let k = 0; k < 30; k++) { const a = rr(0, TAU), d = rr(20, maxD), x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.hypot(x - 3, z + 19) < 25) continue; const y = heightAt(x, z); if (y > minY && y < -3) return [x, y, z]; } return null; };
  const star = (() => { const parts = [P(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 10), '#fff')]; for (let i = 0; i < 5; i++) parts.push(P(new THREE.ConeGeometry(0.075, 0.42, 6).rotateZ(-Math.PI / 2).translate(0.23, 0, 0), '#fff', [0, 0, 0], [0, -(i / 5) * TAU, 0], [1, 0.45, 1], (x, y, z) => { const t = 1 - Math.hypot(x, z) * 0.6; return [t, t, t]; })); return M(...parts); })();
  const urchin = (() => { const r = lcg(5), parts = [P(new THREE.IcosahedronGeometry(0.16, 1), '#fff', [0, 0.12, 0], [0, 0, 0], [1, 0.8, 1], () => [0.35, 0.3, 0.4])];
    for (let i = 0; i < 26; i++) { const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u); const dir = new THREE.Vector3(s * Math.cos(th), Math.abs(u) * 0.9 + 0.1, s * Math.sin(th)).normalize(); e.setFromQuaternion(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      parts.push(P(new THREE.ConeGeometry(0.012, 0.3, 3).translate(0, 0.15, 0), '#fff', [dir.x * 0.13, 0.12 + dir.y * 0.1, dir.z * 0.13], [e.x, e.y, e.z], [1, 1, 1], () => [0.55, 0.45, 0.6])); }
    return M(...parts); })();
  const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), 0.4);
  const scatter = (geos, n, pal, where, size, bright = 1) => { const ims = geos.map((g) => new THREE.InstancedMesh(g, mat, n)); let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) { const pt = where(); if (!pt) continue; const s = rr(size[0], size[1]); q.setFromEuler(e.set(rr(-0.12, 0.12), rr(0, TAU), rr(-0.12, 0.12))); m4.compose(v.set(pt[0], pt[1] - 0.02, pt[2]), q, sc.set(s, s, s));
      ims.forEach((im, j) => { im.setMatrixAt(k, m4); col.set(j === ims.length - 1 ? rpick(pal) : '#f2e8dc').multiplyScalar(j === ims.length - 1 ? bright : 1); im.setColorAt(k, col); }); k++; }
    for (const im of ims) { im.count = k; im.frustumCulled = false; scene.add(im); out.reefMeshes.push(im); } };
  const free = (f) => () => { const p = f(); if (!p || !occFree(p[0], p[2], 0.5)) return null; occAdd(p[0], p[2], 0.5); return p; };
  scatter([star], 140, ['#ff7043', '#e63946', '#b5179e', '#f4a261', '#3a86ff', '#ffbe0b'], free(() => (SRr() < 0.5 ? reefPoint(-85) : shelfPoint(260, -85))), [0.7, 1.4]);
  scatter([urchin], 110, ['#b39ddb', '#9575cd', '#ffffff', '#7e57c2'], free(() => (SRr() < 0.7 ? reefPoint(-85) : shelfPoint(260, -90))), [0.8, 1.5]);
  // bioluminescent deep corals: dark stalks, glowing tips (bloom picks them up)
  { const tips = [], stalk = coralGeos.branch(313, 0.8, tips), tipGeo = M(...tips.map(([x, y, z, r]) => P(new THREE.OctahedronGeometry(r * 1.5, 0), '#fff', [x, y, z])));
    const sm = new THREE.InstancedMesh(stalk, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, color: '#3a3346' }), 120), tm = new THREE.InstancedMesh(tipGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 120); let k = 0;
    for (let i = 0; i < 1200 && k < 120; i++) { const x = rr(-860, 860), z = rr(-860, 860), y = heightAt(x, z); if (y > -250 || y < -840) continue; const s = rr(1.2, 3.2); q.setFromEuler(e.set(rr(-0.2, 0.2), rr(0, TAU), rr(-0.2, 0.2))); m4.compose(v.set(x, y - 0.2, z), q, sc.set(s, s, s));
      sm.setMatrixAt(k, m4); tm.setMatrixAt(k, m4); tm.setColorAt(k, col.set(rpick(['#4df3ff', '#ff4fd8', '#7cff6b', '#6f8bff'])).multiplyScalar(2.2)); k++; }
    for (const im of [sm, tm]) { im.count = k; im.frustumCulled = false; scene.add(im); } out.deepMeshes = [sm, tm]; }
}
function mergeUV(geos) { // merge keeping uv
  const pos = [], uv = [], nrm = []; for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); nrm.push(...g.attributes.normal.array); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); return g;
}
export function coralGeos() {
  const branch = (seedv, thick, tips) => { const parts = []; const rng = (() => { let s = seedv; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const br = (x, y, z, dx, dy, dz, len, r, d) => { const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len; const mid = new THREE.Vector3(x + ex, y + ey, z + ez).multiplyScalar(0.5);
      const g = new THREE.CylinderGeometry(r * 0.75, r, len, 5, 1, true); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()); const e = new THREE.Euler().setFromQuaternion(q);
      parts.push(P(g, '#ffffff', [mid.x, mid.y, mid.z], [e.x, e.y, e.z], [1, 1, 1], (px, py) => { const v = 0.75 + Math.min(0.25, py * 0.15); return [v, v, v]; }));
      if (d <= 0) { if (tips) tips.push([ex, ey, ez, r]); else parts.push(P(new THREE.SphereGeometry(r * 0.9, 5, 3), '#ffffff', [ex, ey, ez])); return; }
      const n = 2 + (rng() < 0.4 ? 1 : 0); for (let i = 0; i < n; i++) { const nd = new THREE.Vector3(dx + (rng() - 0.5) * 1.2, dy + 0.2, dz + (rng() - 0.5) * 1.2).normalize(); br(ex, ey, ez, nd.x, nd.y, nd.z, len * 0.72, r * 0.72, d - 1); } };
    for (let k = 0; k < 3; k++) { const a = k * 2.1; br(0, 0, 0, Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3, 0.55, 0.09 * thick, 3); }
    return M(...parts); };
  const brain = displace(P(new THREE.SphereGeometry(0.7, 20, 12, 0, TAU, 0, Math.PI / 2), '#fff', [0, 0, 0], [0, 0, 0], [1, 0.75, 1], (x, y, z) => { const v = Math.sin(x * 14 + Math.sin(z * 9) * 2) > 0.2 ? 0.95 : 0.7; return [v, v, v]; }), 0.04, 6, 2);
  const fanParts = []; for (let i = 0; i < 14; i++) { const a = -0.9 + (i / 13) * 1.8; fanParts.push(P(new THREE.CylinderGeometry(0.012, 0.02, 1.4, 4).translate(0, 0.7, 0), '#fff', [0, 0, 0], [0, 0, a])); }
  for (let k = 1; k < 5; k++) fanParts.push(P(new THREE.TorusGeometry(k * 0.28, 0.01, 3, 18, 1.8), '#fff', [0, 0, 0], [0, 0, Math.PI / 2 - 0.9]));
  const fan = M(...fanParts);
  coralGeos.branch = branch;
  // soft coral: short trunk under a bushy crown of lobes
  const soft = (() => { const r = lcg(11), parts = [P(new THREE.CylinderGeometry(0.08, 0.15, 0.5, 6).translate(0, 0.25, 0), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], () => [0.7, 0.7, 0.7])];
    for (let i = 0; i < 14; i++) { const a = r() * TAU, e = r() * 1.2, d = 0.3 + r() * 0.25; parts.push(P(new THREE.SphereGeometry(0.15 + r() * 0.1, 7, 5), '#fff', [Math.cos(a) * Math.sin(e) * d, 0.5 + Math.cos(e) * d * 0.7, Math.sin(a) * Math.sin(e) * d], [0, 0, 0], [1, 1.25, 1], (x, y) => { const v = Math.min(1, 0.78 + Math.max(0, y - 0.4) * 0.4); return [v, v, v]; })); }
    return M(...parts); })();
  // bubble coral: a mound of translucent-looking vesicles
  const bubble = (() => { const r = lcg(31), parts = [P(new THREE.SphereGeometry(0.35, 10, 6, 0, TAU, 0, Math.PI / 2), '#fff', [0, 0, 0], [0, 0, 0], [1, 0.5, 1], () => [0.55, 0.55, 0.55])];
    for (let i = 0; i < 14; i++) { const a = r() * TAU, d = r() * 0.3, rad = 0.09 + r() * 0.08; parts.push(P(new THREE.SphereGeometry(rad, 8, 6), '#fff', [Math.cos(a) * d, 0.12 + r() * 0.2 + rad * 0.5, Math.sin(a) * d], [0, 0, 0], [1, 1, 1], () => [1, 1, 1])); }
    return M(...parts); })();
  // sea whips: tall, thin, gently curving rods
  const whip = (() => { const r = lcg(47), parts = []; for (let i = 0; i < 7; i++) { const a = r() * TAU, lean = 0.15 + r() * 0.25, h = 1.2 + r() * 1.4, pts = [];
      for (let j = 0; j <= 8; j++) { const t = j / 8; pts.push(new THREE.Vector3(Math.cos(a) * lean * t * h + Math.sin(t * 5 + i) * 0.06, t * h, Math.sin(a) * lean * t * h)); }
      parts.push(P(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.028, 4, false), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => { const v = 0.7 + Math.min(0.3, y * 0.15); return [v, v, v]; })); }
    return M(...parts); })();
  return [['branch', branch(7, 1), 110], ['stag', branch(99, 1.8), 60], ['brain', brain, 75], ['fan', fan, 60], ['soft', soft, 80], ['bubble', bubble, 55], ['whip', whip, 60]];
}

// ---------------------------------------------------------------- set pieces
function rusty(x, y, z, base = [0.42, 0.26, 0.17]) { const n = NZ(x * 0.35 + 3, y * 0.4 + z * 0.3) * 0.5 + 0.5, m = NZ(x * 1.7, z * 1.7 + y) * 0.5 + 0.5; const k = 0.7 + n * 0.5; const g = m > 0.72 ? 0.6 : 1; return [base[0] * k * g + (m > 0.72 ? 0.05 : 0), base[1] * k + (m > 0.72 ? 0.12 : 0), base[2] * k * g]; }
function shipHull(L, H, W, colorFn) {
  const g = new THREE.BoxGeometry(L, H, W, 24, 4, 6); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const bx = L * 0.2;
    if (x > bx) z *= 1 - Math.pow((x - bx) / (L / 2 - bx), 1.6) * 0.95;
    if (x < -L * 0.4) z *= 1 - ((-L * 0.4 - x) / (L * 0.1)) * 0.25;
    z *= lerp(0.5, 1, (y + H / 2) / H); if (y > 0 && x > L * 0.3) y += (x - L * 0.3) * 0.12; p.setXYZ(i, x, y, z); }
  return P(g, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], colorFn);
}
// one piece of a ship hull of total length L, spanning x0..x1, with the torn end at x = brokenAt
function hullSection(L, H, W, x0, x1, colorFn, brokenAt) {
  const len = x1 - x0, g = new THREE.BoxGeometry(len, H, W, Math.max(4, Math.round(len / 1.4)), 5, 8).translate((x0 + x1) / 2, 0, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const bx = L * 0.2;
    if (x > bx) z *= 1 - Math.pow((x - bx) / (L / 2 - bx), 1.6) * 0.95;
    if (x < -L * 0.4) z *= 1 - ((-L * 0.4 - x) / (L * 0.1)) * 0.25;
    z *= lerp(0.5, 1, (y + H / 2) / H); if (y > 0 && x > L * 0.3) y += (x - L * 0.3) * 0.12;
    if (Math.abs(x - brokenAt) < 0.01) { x += NZ(y * 0.9 + 3, z * 0.9) * 2.4; y += NZ(z * 0.7, y * 0.7 + 5) * 0.9; }
    p.setXYZ(i, x, y, z); }
  g.computeVertexNormals();
  return P(g, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.abs(x - brokenAt) < 2.6 && NZ(y * 1.3, z * 1.3) > -0.1 ? [0.05, 0.04, 0.04] : colorFn(x, y, z)));
}
function colliderLine(colliders, obj, from, to, r, n) { obj.updateMatrixWorld(true); for (let k = 0; k <= n; k++) { const v = new THREE.Vector3().lerpVectors(from, to, n ? k / n : 0).applyMatrix4(obj.matrixWorld); colliders.push({ x: v.x, y: v.y, z: v.z, r }); } }
export function buildSetPieces(scene, colliders) {
  const out = {}; const P0 = Object.fromEntries(POIS.map((p) => [p.id, p]));
  const metal = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide }), 0.5);
  out.sites = {};
  // shipwreck: a cargo ship broken in two, the halves lying apart on the plain
  { const w = P0.wreck, L = 56, H = 10, W = 12, deck = H / 2;
    const hullCol = (x, y, z) => { if (y < -1.8) return rusty(x, y, z, [0.4, 0.12, 0.09]); if (NZ(x * 0.7 + 11, y * 0.9 + z * 0.2) > 0.38) return [0.2, 0.28, 0.19]; return rusty(x, y, z, [0.17, 0.17, 0.18]); };
    const steel = (x, y, z) => (NZ(x * 0.9 + 4, y * 0.9 + z * 0.4) > 0.3 ? [0.19, 0.26, 0.17] : rusty(x, y, z, [0.25, 0.23, 0.2]));
    const dark = () => [0.03, 0.03, 0.035];
    const rails = (x0, x1, zz) => { const r = []; for (let x = x0; x <= x1; x += 1.6) for (const sd of [-1, 1]) r.push(P(new THREE.BoxGeometry(0.1, 1.1, 0.1), '#4a3a2e', [x, deck + 0.55, sd * zz(x)])); for (const sd of [-1, 1]) r.push(P(new THREE.BoxGeometry(x1 - x0, 0.08, 0.08), '#4a3a2e', [(x0 + x1) / 2, deck + 1.1, sd * zz((x0 + x1) / 2)])); return r; };
    const halfW = (x) => { const bx = L * 0.2; let z = W / 2; if (x > bx) z *= 1 - Math.pow((x - bx) / (L / 2 - bx), 1.6) * 0.95; return z * 0.92; };
    // stern half: superstructure, funnel, lifeboat davits, propeller and rudder
    const stern = [hullSection(L, H, W, -28, 2, hullCol, 2),
      P(new THREE.BoxGeometry(11, 5.5, 10.4), '#fff', [-17, deck + 2.75, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.abs(y - (deck + 3.8)) < 0.45 && Math.abs(z) > 5 ? [0.04, 0.05, 0.06] : steel(x, y, z))),
      P(new THREE.BoxGeometry(7, 3, 12), '#fff', [-18, deck + 7, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.abs(y - (deck + 7.3)) < 0.6 && (Math.abs(z) > 5.8 || x > -14.6) ? [0.04, 0.05, 0.06] : steel(x, y, z))),
      P(new THREE.CylinderGeometry(1.5, 1.8, 7, 14), '#fff', [-20.5, deck + 9.5, 0], [0, 0, 0.12], [1, 1, 1], (x, y, z) => (Math.abs(y - (deck + 11.8)) < 0.7 ? [0.55, 0.14, 0.08] : rusty(x, y, z, [0.2, 0.17, 0.15]))),
      P(new THREE.CylinderGeometry(0.18, 0.22, 7, 6), '#3a2e26', [-17, deck + 11.5, 0]), P(new THREE.BoxGeometry(0.15, 0.15, 4), '#3a2e26', [-17, deck + 13.6, 0]),
      ...[-1, 1].flatMap((sd) => [-22, -12].map((x) => P(new THREE.TorusGeometry(1.2, 0.1, 5, 10, Math.PI * 0.6), '#3a2e26', [x, deck + 5.8, sd * 5.4], [0, 0, 0], [1, 1, 1]))),
      P(new THREE.BoxGeometry(4.5, 0.9, 7), '#fff', [-3.5, deck + 0.45, 0], [0, 0, 0], [1, 1, 1], steel), P(new THREE.BoxGeometry(4.1, 0.06, 6.6), '#000', [-3.5, deck + 0.93, 0], [0, 0, 0], [1, 1, 1], dark),
      ...rails(-27, 1, halfW),
      P(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 10), '#6a5a48', [-28.4, -2.4, 0], [0, 0, Math.PI / 2]),
      ...[0, 1, 2, 3].map((i) => P(new THREE.BoxGeometry(0.25, 2.4, 0.9), '#7a6448', [-28.8, -2.4, 0], [(i * Math.PI) / 2 + 0.3, 0, 0], [1, 1, 1], () => [0.48, 0.38, 0.26]).translate(0, 0, 0)),
      P(new THREE.BoxGeometry(2.6, 4.2, 0.3), '#fff', [-29.6, -1.6, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => rusty(x, y, z))];
    // bow half: hatches, a derrick, the forecastle and the anchor chain running down to the sand
    const chain = []; for (let i = 0; i < 16; i++) { const t = i / 15; chain.push(P(new THREE.TorusGeometry(0.28, 0.08, 4, 8), '#3a2c22', [26 + t * 6, 1.2 - t * 6.5 + Math.sin(t * Math.PI) * -0.6, 4.6 + t * 3], [i % 2 ? Math.PI / 2 : 0, 0, 0.5])); }
    const bow = [hullSection(L, H, W, 6, 28, hullCol, 6),
      ...[9.5, 17.5].flatMap((x) => [P(new THREE.BoxGeometry(5, 1, 7.4), '#fff', [x, deck + 0.5, 0], [0, 0, 0], [1, 1, 1], steel), P(new THREE.BoxGeometry(4.6, 0.06, 7), '#000', [x, deck + 1.03, 0], [0, 0, 0], [1, 1, 1], dark)]),
      P(new THREE.CylinderGeometry(0.35, 0.45, 9, 8), '#fff', [13.5, deck + 4.5, 0], [0, 0, 0], [1, 1, 1], steel), P(new THREE.CylinderGeometry(0.18, 0.22, 10, 6), '#fff', [16, deck + 5, 0], [0, 0, -0.95], [1, 1, 1], steel),
      P(new THREE.BoxGeometry(6, 2.2, 8), '#fff', [24.5, deck + 1.1 + 1.3, 0], [0, 0, 0], [1, 1, 1], steel), P(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8), '#5a4a3a', [23, deck + 3.6, 1.6], [Math.PI / 2, 0, 0]), P(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8), '#5a4a3a', [23, deck + 3.6, -1.6], [Math.PI / 2, 0, 0]),
      ...rails(7, 21, halfW), ...chain,
      P(new THREE.BoxGeometry(0.3, 2.6, 0.3), '#2e2620', [32, -5.4, 7.6]), P(new THREE.TorusGeometry(0.9, 0.16, 5, 10, Math.PI), '#2e2620', [32, -6.6, 7.6], [0, 0, Math.PI])];
    const sg = new THREE.Group(); sg.add(new THREE.Mesh(M(...stern), metal));
    const bg = new THREE.Group(); bg.add(new THREE.Mesh(M(...bow), metal));
    const place = (grp, dx, dz, ry, rx, rz) => { const x = w.x + dx, z = w.z + dz; grp.position.set(x, heightAt(x, z) + H * 0.32, z); grp.rotation.set(rx, ry, rz); scene.add(grp); grp.updateMatrixWorld(true); };
    place(sg, -12, 7, 0.6, 0.02, 0.24); place(bg, 12, -9, 1.05, -0.06, -0.3);
    colliderLine(colliders, sg, new THREE.Vector3(-26, 0, 0), new THREE.Vector3(0, 0, 0), 5.4, 7); colliderLine(colliders, sg, new THREE.Vector3(-18, deck + 4, 0), new THREE.Vector3(-18, deck + 4, 0), 5.5, 0);
    colliderLine(colliders, bg, new THREE.Vector3(7, 0, 0), new THREE.Vector3(27, 0, 0), 4.8, 6);
    const W2 = (grp, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(grp.matrixWorld);
    out.sites.wreck = { center: new THREE.Vector3(w.x, heightAt(w.x, w.z), w.z), r: 60,
      spots: [W2(sg, -24, deck + 0.4, 2.5), W2(sg, -24, deck + 0.4, -2.5), W2(sg, -8, deck + 0.4, 3), W2(sg, -3.5, deck + 1.3, 1.5), W2(sg, -1, deck + 0.4, -3), W2(bg, 9.5, deck + 1.3, 1.8), W2(bg, 13, deck + 0.4, -3), W2(bg, 17.5, deck + 1.3, -1.5), W2(bg, 20.5, deck + 0.4, 3)],
      leaks: [W2(sg, 1.5, 0.5, 0), W2(bg, 6.5, -0.5, 1), W2(sg, -20.5, deck + 13, 0)] };
    out.wreck = sg; }
  // airliner: a twin-engine propeller plane, its tail section and right wing torn off nearby
  { const w = P0.plane;
    const alu = (x, y, z) => { const n = NZ(x * 0.8 + 2, y * 0.9 + z * 0.6) * 0.5 + 0.5; if (NZ(x * 1.6 + 7, z * 1.6 + y) > 0.3) return [0.2, 0.29, 0.17]; const v = 0.38 + n * 0.2; return [v * 0.95, v, v * 1.04]; };
    const body = (x, y, z) => { const r = Math.hypot(x, y) || 1; if (y / r > -0.2 && y / r < 0.12 && Math.abs(x) > 0.3) return [0.16, 0.26, 0.52]; return alu(x, y, z); };
    const R = (z) => (z > 6 ? lerp(1.35, 0.35, (z - 6) / 3.6) : z > 0 ? 1.4 : z > -6 ? lerp(1.4, 1.05, -z / 6) : lerp(1.05, 0.4, (-z - 6) / 4.2));
    const fus = (z0, z1) => { const prof = []; for (let z = z0; z <= z1 + 1e-6; z += 0.5) prof.push([R(z), z]); return P(lathe(prof, 18), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], body); };
    const windows = (z0, z1) => { const r = []; for (let z = z0; z <= z1; z += 1.15) for (const sd of [-1, 1]) r.push(P(new THREE.BoxGeometry(0.06, 0.42, 0.55), '#0a1016', [sd * R(z) * 0.985, 0.45, z])); return r; };
    const wing = (sd, len) => { const g = new THREE.BoxGeometry(len, 0.34, 3.4, 8, 1, 2); const q = g.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), t = (x + len / 2) / len; q.setZ(i, q.getZ(i) * (1 - t * 0.5) - t * 0.6); q.setY(i, q.getY(i) * (1 - t * 0.5) + t * 0.7); } g.translate(sd * len / 2, 0, 0); if (sd < 0) g.scale(1, 1, 1); return P(g, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], alu); };
    const engine = (x, bent) => [P(new THREE.CylinderGeometry(0.72, 0.62, 3.6, 14), '#fff', [x, -0.1, 1.2], [Math.PI / 2, 0, 0], [1, 1, 1], alu), P(new THREE.SphereGeometry(0.42, 10, 8), '#3a3e44', [x, -0.1, 3.1]),
      ...[0, 1, 2].map((i) => P(new THREE.BoxGeometry(0.22, 2.3, 0.06), '#2b2f33', [x, -0.1, 3.25], [bent && i === 1 ? 0.7 : 0, 0, (i * TAU) / 3 + 0.3], [1, 1, 1], () => [0.17, 0.18, 0.2]).translate(0, 0, 0))];
    const cockpit = [-0.45, 0.45].map((xx) => P(new THREE.BoxGeometry(0.62, 0.38, 0.06), '#0a1016', [xx, 0.78, 7.55], [-0.5, xx * 0.6, 0]));
    const front = [fus(-3.5, 9.6), ...windows(-2.8, 5), ...cockpit, wing(1, 11), ...engine(4.3, false), P(new THREE.CircleGeometry(1.4, 18), '#050608', [0, 0, -3.49], [0, Math.PI, 0])];
    const tail = [fus(-10.2, -4), ...windows(-5.6, -4.4), P(vFin([[-6.5, 1.0], [-9.4, 3.8], [-10.2, 3.8], [-10.1, 0.6]]), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], alu),
      P(new THREE.BoxGeometry(7, 0.18, 1.8), '#fff', [0, 0.3, -9.3], [0, 0, 0], [1, 1, 1], alu), P(new THREE.CircleGeometry(1.1, 16), '#050608', [0, 0, -3.99], [0, 0, 0])];
    const rwing = [wing(-1, 11), ...engine(-4.3, true)];
    const fg = new THREE.Group(); fg.add(new THREE.Mesh(M(...front), metal));
    const tg = new THREE.Group(); tg.add(new THREE.Mesh(M(...tail), metal));
    const rg = new THREE.Group(); rg.add(new THREE.Mesh(M(...rwing), metal));
    const put = (grp, dx, dz, lift, ry, rx, rz) => { const x = w.x + dx, z = w.z + dz; grp.position.set(x, heightAt(x, z) + lift, z); grp.rotation.set(rx, ry, rz); scene.add(grp); grp.updateMatrixWorld(true); };
    put(fg, 0, 0, 0.9, -0.9, -0.08, 0.16); put(tg, -9, -7, 0.7, -0.4, 0.05, -0.5); put(rg, 5, -9, 0.4, -1.6, 0, 0.1);
    colliderLine(colliders, fg, new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, 9), 1.7, 6); colliderLine(colliders, fg, new THREE.Vector3(1.5, 0, -0.5), new THREE.Vector3(10.5, 0.5, -1), 1.1, 5);
    colliderLine(colliders, tg, new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, -4), 1.3, 3); colliderLine(colliders, rg, new THREE.Vector3(-1.5, 0, -0.5), new THREE.Vector3(-10.5, 0.5, -1), 1.1, 5);
    const W2 = (grp, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(grp.matrixWorld);
    out.sites.plane = { center: new THREE.Vector3(w.x, heightAt(w.x, w.z), w.z), r: 48,
      spots: [W2(fg, 3, 0.55, -0.6), W2(fg, 7.5, 0.9, -1.2), W2(fg, 0, -0.9, -4.6), W2(fg, 0.8, -0.9, -6), W2(tg, 0, -0.6, -3), W2(rg, -5.5, 0.6, -1)],
      leaks: [W2(fg, 4.3, 0.2, -1.2), W2(rg, -4.3, 0.2, -1.2)] }; }
  // whale fall: a humpback skeleton on the sediment, grazed by bone-eating worms, with bacterial mats around it
  out.far = [];
  const matMesh = (patches, y0) => { const parts = patches.map(([x, z, r, col], i) => { const g = new THREE.CircleGeometry(r, 18).rotateX(-Math.PI / 2), q = g.attributes.position;
      for (let k = 1; k < q.count; k++) { const px = q.getX(k), pz = q.getZ(k), f = 1 + NZ(px * 0.9 + i * 5, pz * 0.9) * 0.35; q.setX(k, px * f); q.setZ(k, pz * f); }
      return P(g, col, [x, y0 + 0.02 + i * 0.002, z], [0, 0, 0], [1, 1, 1], (px, py, pz, c) => { const n = NZ(px * 3 + i, pz * 3) * 0.12; return [c.r + n, c.g + n, c.b + n]; }); });
    return new THREE.Mesh(M(...parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); };
  { const w = P0.whalefall; const g = new THREE.Group(); const parts = [];
    const bone = (x, y, z) => { const n = NZ(x * 1.3 + 4, y * 1.3 + z * 1.1) * 0.5 + 0.5; return NZ(x * 0.5 + 7, z * 0.5 + y) > 0.3 ? [0.3 + 0.14 * n, 0.25 + 0.12 * n, 0.17 + 0.08 * n] : [0.56 + 0.08 * n, 0.53 + 0.07 * n, 0.45 + 0.06 * n]; };
    const B = (geo, pos, rot, scl) => parts.push(P(geo, '#fff', pos, rot || [0, 0, 0], scl || [1, 1, 1], bone));
    const tube = (pts, r) => B(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), 14, r, 6), [0, 0, 0]);
    // vertebral column from the skull (x = 4) to the tail tip (x = -11), with a gentle S in the sediment
    const NV = 44, vpos = [];
    for (let i = 0; i < NV; i++) { const t = i / (NV - 1), x = 4 - t * 15, z = Math.sin(t * 3.2) * 0.9, sz = lerp(0.42, 0.1, Math.pow(t, 0.9)), y = sz * 0.9; vpos.push([x, y, z, sz]);
      B(new THREE.CylinderGeometry(sz, sz, sz * 0.8, 10), [x, y, z], [0, 0, Math.PI / 2]);
      if (t < 0.8) B(new THREE.BoxGeometry(sz * 0.35, sz * (t < 0.55 ? 2.2 : 1.2), sz * 0.25), [x - sz * 0.25, y + sz * (t < 0.55 ? 1.5 : 1), z], [0, 0, 0.3]);
      if (t > 0.15 && t < 0.62) for (const sd of [-1, 1]) B(new THREE.BoxGeometry(sz * 0.5, sz * 0.18, sz * 2.2), [x, y, z + sd * sz * 1.5]); }
    // ribs splayed out on both sides where the carcass collapsed; a few have fallen flat
    for (let i = 0; i < 13; i++) { const [x, y, z] = vpos[5 + i], L = 1.9 + Math.sin((i / 12) * Math.PI) * 1.1;
      for (const sd of [-1, 1]) { if ((i * 5 + (sd > 0 ? 1 : 0)) % 7 === 0) continue; const fl = (i * 3 + (sd > 0 ? 2 : 0)) % 5 === 0, dx = fl ? rr(-1.2, 1.2) : -0.3;
        tube([[x, y + 0.1, z + sd * 0.3], [x - 0.1, y + (fl ? 0.1 : 0.55), z + sd * (0.3 + L * 0.35)], [x - 0.2 + dx * 0.5, fl ? 0.1 : y * 0.5 + 0.25, z + sd * (0.3 + L * 0.75)], [x + dx, 0.1, z + sd * (0.3 + L)]], 0.07 + 0.03 * Math.sin((i / 12) * Math.PI)); } }
    // skull: a broad wedge tapering to the rostrum, the cranium domed at the back
    const sk = new THREE.BoxGeometry(5.4, 0.8, 2.8, 12, 2, 6), sp = sk.attributes.position;
    for (let k = 0; k < sp.count; k++) { const x = sp.getX(k), y = sp.getY(k), z = sp.getZ(k), t = clamp((x + 2.7) / 5.4, 0, 1); sp.setXYZ(k, x, y * lerp(1.3, 0.35, t) + (y > 0 ? Math.cos((z / 1.4) * 1.2) * 0.15 : 0), z * lerp(1, 0.22, Math.pow(t, 1.3))); }
    B(sk, [7.1, 0.5, 0.1], [0, 0.04, 0.06]); B(new THREE.SphereGeometry(1, 14, 10), [4.9, 0.75, 0.1], [0, 0, 0], [1.15, 0.8, 1.4]);
    for (const sd of [-1, 1]) B(new THREE.SphereGeometry(0.28, 8, 6), [4.2, 0.5, 0.1 + sd * 0.35]); // occipital condyles
    // lower jawbones lying apart beside the skull
    for (const sd of [-1, 1]) tube([[4.3, 0.22, sd * 1.1], [6.4, 0.22, sd * (2.2 + (sd > 0 ? 0.4 : 0))], [8.6, 0.18, sd * 2.1], [10.2, 0.15, sd * 1.3]], 0.19);
    // flippers: shoulder blade, arm bones and the long rows of finger bones, one on each side
    for (const sd of [-1, 1]) { const bx = sd > 0 ? 1.8 : 2.4, bz = sd * (sd > 0 ? 2.6 : 3.2), ang = sd > 0 ? 0.5 : -0.2;
      const f = (u, v) => [bx - Math.sin(ang) * v, 0.15, bz + sd * Math.cos(ang) * u + Math.sin(ang) * v]; // u runs out along the flipper, v across it
      B(new THREE.CircleGeometry(1.1, 10, 0, Math.PI * 0.8), [bx + 0.6, 0.35, bz - sd * 1.3], [-Math.PI / 2 + 0.25 * sd, 0, ang]);
      tube([f(0, 0), f(0.9, 0.05)], 0.17); tube([f(0.95, -0.12), f(2.3, -0.1)], 0.11); tube([f(0.95, 0.14), f(2.3, 0.16)], 0.1);
      for (let d = 0; d < 4; d++) for (let j = 0; j < 5 - (d === 0 ? 1 : 0); j++) { const [px, , pz] = f(2.5 + j * 0.42, -0.2 + d * 0.13); B(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 6), [px, 0.12, pz], [Math.PI / 2, 0, ang + (sd < 0 ? Math.PI : 0)]); } }
    g.add(new THREE.Mesh(M(...parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
    // bacterial mats (white Beggiatoa, yellow sulphur bacteria) where the carcass rotted into the sediment
    const pt = []; for (let i = 0; i < 30; i++) { const t = rr(-0.1, 1.1), x = 4 - t * 15 + rr(-1.5, 1.5), z = rr(-3.2, 3.2); pt.push([x, z, rr(0.4, 1.4), SRr() < 0.6 ? '#9d9a90' : SRr() < 0.5 ? '#a8862c' : '#9a5424']); }
    g.add(matMesh(pt, 0));
    // bone-eating worms: tiny red plumes crowding the bones
    const wg = M(P(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 4).translate(0, 0.07, 0), '#d8c8b8'), P(new THREE.SphereGeometry(0.045, 6, 4), '#e0304a', [0, 0.15, 0], [0, 0, 0], [1, 1.4, 1]));
    const worms = new THREE.InstancedMesh(wg, addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x2a0008, emissiveIntensity: 0.6 }), 0.05), 420); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let wn = 0;
    for (let i = 0; i < 420; i++) { const [x, y, z, sz] = vpos[Math.floor(Math.pow(SRr(), 1.3) * 34)]; const a = rr(-1.2, 1.2); q.setFromEuler(new THREE.Euler(a * 0.5, 0, a)); const sc = rr(0.7, 1.5);
      m4.compose(new THREE.Vector3(x + rr(-sz, sz) * 0.6, y + Math.cos(a) * sz * 0.95, z + Math.sin(a) * sz * 0.95 * 1.2), q, new THREE.Vector3(sc, sc, sc)); worms.setMatrixAt(wn++, m4); }
    worms.count = wn; g.add(worms);
    const y = heightAt(w.x, w.z); g.position.set(w.x, y - 0.05, w.z); g.rotation.y = 0.4; scene.add(g); g.updateMatrixWorld(true);
    colliderLine(colliders, g, new THREE.Vector3(6.5, 0.5, 0.1), new THREE.Vector3(6.5, 0.5, 0.1), 1.6, 0); colliderLine(colliders, g, new THREE.Vector3(3, 0.3, 0), new THREE.Vector3(-6, 0.3, 0), 0.6, 4);
    out.far.push({ o: g, x: w.x, z: w.z }); out.whale = g; }
  // container ship
  { const w = P0.cship; const cols = ['#b8392b', '#2d6fb0', '#2e8b57', '#d9822b', '#7d4ba0', '#6d7880', '#c0a030', '#1f8a86'];
    const hullCol = (x, y, z) => (y < -1.5 ? rusty(x, y, z, [0.45, 0.12, 0.1]) : rusty(x, y, z, [0.13, 0.18, 0.28]));
    const half = (flip) => { const g = new THREE.Group(); const parts = [shipHull(44, 10, 14, hullCol).translate(flip ? -22 : 22, 0, 0)];
      for (let s = 0; s < 5; s++) for (let t = 0; t < 3; t++) for (let r = 0; r < 3; r++) { if (NZ(s * 1.3 + (flip ? 9 : 0), t + r * 2.1) > 0.35) continue; const c = cols[(s * 3 + t + r) % cols.length]; parts.push(P(new THREE.BoxGeometry(7, 2.5, 2.5), c, [(flip ? -1 : 1) * (6 + s * 7.3), 6.3 + t * 2.55, -3.2 + r * 3.2], [0, 0, 0], [1, 1, 1], (x, y, z) => { const cc = new THREE.Color(c); const rib = Math.sin(x * 9) > 0.6 ? 0.8 : 1; return [cc.r * rib, cc.g * rib, cc.b * rib]; })); }
      if (flip) parts.push(P(new THREE.BoxGeometry(6, 14, 12), '#c8ccd0', [-38, 11, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.abs(y - 15) < 0.8 && Math.abs(z) > 5.9 ? [0.1, 0.15, 0.2] : [0.7, 0.72, 0.74])));
      g.add(new THREE.Mesh(M(...parts), metal)); return g; };
    const y = heightAt(w.x, w.z);
    const a = half(false); a.position.set(w.x + 6, y + 3, w.z - 6); a.rotation.set(0.04, 1.3, 0.18); scene.add(a);
    const b = half(true); b.position.set(w.x - 4, y + 3, w.z + 8); b.rotation.set(-0.08, 1.1, -0.22); scene.add(b);
    colliderLine(colliders, a, new THREE.Vector3(0, 0, 0), new THREE.Vector3(40, 0, 0), 6.5, 8); colliderLine(colliders, b, new THREE.Vector3(0, 0, 0), new THREE.Vector3(-42, 0, 0), 6.5, 8); }
  // hydrothermal vents: black-smoker chimneys on mineral mounds, ringed by tube worms, mussels, white crabs and bacterial mats
  { out.vents = []; out.smokers = []; const w = P0.vents; const ventMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(2.5), fog: false });
    const crust = (i) => (px, py, pz) => { const n = NZ(px * 1.6 + i * 3, py * 0.9 + pz * 1.6), m = NZ(px * 4 + 2, py * 3 - pz * 4); if (m > 0.5) return [0.8, 0.74, 0.3]; if (n > 0.35) return [0.5, 0.25, 0.09]; if (n < -0.45) return [0.66, 0.64, 0.6]; return [0.12, 0.1, 0.11]; };
    const chimney = (i, h, r0) => { const prof = []; for (let k = 0; k <= 14; k++) { const t = k / 14; prof.push(new THREE.Vector2(Math.max(0.22, lerp(r0, r0 * 0.28, Math.pow(t, 0.7)) + NZ(i * 3 + k * 0.9, 1) * r0 * 0.25), t * h)); } return new THREE.LatheGeometry(prof, 12); };
    const glowTop = (x, y, z, r) => { const t = new THREE.Mesh(new THREE.CircleGeometry(r, 12).rotateX(-Math.PI / 2), glowMat); t.position.set(x, y + 0.02, z); scene.add(t); };
    const wormG = M(P(new THREE.CylinderGeometry(0.05, 0.06, 1, 5).translate(0, 0.5, 0), '#e6ddcc'), P(new THREE.SphereGeometry(0.1, 6, 5), '#d8243c', [0, 1.02, 0], [0, 0, 0], [1, 1.5, 1]));
    const worms = new THREE.InstancedMesh(wormG, addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x220000, emissiveIntensity: 0.5 }), 0.12), 600);
    const musG = P(new THREE.SphereGeometry(0.12, 6, 4), '#1d1a1c', [0, 0.03, 0], [0, 0, 0], [1, 0.5, 1.9], (x, y, z) => (y > 0.05 ? [0.16, 0.14, 0.12] : [0.07, 0.06, 0.07]));
    const mussels = new THREE.InstancedMesh(musG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }), 900);
    const crabParts = [P(new THREE.SphereGeometry(0.16, 8, 6), '#f2eee4', [0, 0.1, 0], [0, 0, 0], [1.1, 0.5, 0.9])];
    for (const sd of [-1, 1]) { for (let l = 0; l < 3; l++) crabParts.push(P(new THREE.BoxGeometry(0.28, 0.025, 0.025), '#e8e2d4', [sd * 0.22, 0.06, -0.08 + l * 0.08], [0, sd * (0.3 - l * 0.3), sd * -0.5]));
      crabParts.push(P(new THREE.BoxGeometry(0.06, 0.05, 0.22), '#f5f0e6', [sd * 0.1, 0.1, 0.22], [0, sd * 0.3, 0]), P(new THREE.SphereGeometry(0.035, 5, 4), '#f5f0e6', [sd * 0.14, 0.1, 0.33])); }
    const crabs = new THREE.InstancedMesh(M(...crabParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 160);
    let wn = 0, mn = 0, cn = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), V = (x, y, z) => new THREE.Vector3(x, y, z); const pt = [];
    for (let i = 0; i < 7; i++) { const x = w.x + rr(-45, 45), z = w.z + rr(-45, 45), y = heightAt(x, z), h = rr(10, 22), r0 = rr(1.9, 2.8);
      const parts = [P(chimney(i, h, r0), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], crust(i)), P(new THREE.SphereGeometry(r0 * 2.6, 14, 6, 0, TAU, 0, Math.PI / 2), '#fff', [0, -0.5, 0], [0, 0, 0], [1, 0.35, 1], crust(i + 9))];
      for (let f = 0; f < 3; f++) { const fy = h * rr(0.25, 0.75), fr = lerp(r0, r0 * 0.28, Math.pow(fy / h, 0.7)) + rr(0.5, 1.1); parts.push(P(new THREE.CylinderGeometry(fr, fr * 0.75, 0.35, 10), '#fff', [rr(-0.2, 0.2), fy, rr(-0.2, 0.2)], [rr(-0.12, 0.12), 0, rr(-0.12, 0.12)], [1, 1, 1], crust(i + 5))); }
      for (let k = 0; k < 3; k++) { const a = rr(0, TAU), d = r0 * rr(0.9, 1.4), hs = h * rr(0.25, 0.5); parts.push(P(chimney(i * 7 + k, hs, r0 * 0.45), '#fff', [Math.cos(a) * d, 0, Math.sin(a) * d], [0, 0, 0], [1, 1, 1], crust(i + k)));
        glowTop(x + Math.cos(a) * d, y - 1 + hs, z + Math.sin(a) * d, 0.2); out.smokers.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, top: y - 1 + hs, k: 0.35 }); }
      const m = new THREE.Mesh(M(...parts), ventMat); m.position.set(x, y - 1, z); scene.add(m); out.far.push({ o: m, x, z });
      glowTop(x, y - 1 + h, z, 0.5); out.vents.push({ x, y: y - 1, z, top: y - 1 + h }); out.smokers.push({ x, z, top: y - 1 + h, k: 1 });
      colliders.push({ x, y: y + h * 0.25, z, r: 2.2 }, { x, y: y + h * 0.6, z, r: 1.4 });
      for (let k = 0; k < 70; k++) { const a = rr(0, TAU), d = rr(r0 + 1, 9), wx = x + Math.cos(a) * d, wz = z + Math.sin(a) * d; q.setFromEuler(new THREE.Euler(rr(-0.2, 0.2), 0, rr(-0.2, 0.2))); const s = rr(0.8, 2.2); m4.compose(V(wx, heightAt(wx, wz) - 0.1, wz), q, V(s, s * rr(0.8, 1.6), s)); if (wn < 600) worms.setMatrixAt(wn++, m4); }
      for (let c = 0; c < 4; c++) { const a = rr(0, TAU), d = rr(r0 + 2, 11), cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d; // mussel beds in clumps
        for (let k = 0; k < 30; k++) { const mx = cx + rr(-1.3, 1.3), mz = cz + rr(-1.3, 1.3); q.setFromEuler(new THREE.Euler(rr(-0.4, 0.4), rr(0, TAU), rr(-0.4, 0.4))); const s = rr(0.7, 1.3); m4.compose(V(mx, heightAt(mx, mz) + 0.02, mz), q, V(s, s, s)); if (mn < 900) mussels.setMatrixAt(mn++, m4); } }
      for (let k = 0; k < 22; k++) { const a = rr(0, TAU), d = rr(r0 * 0.9, r0 * 2.6), cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d; q.setFromEuler(new THREE.Euler(0, rr(0, TAU), 0)); const s = rr(0.8, 1.4);
        m4.compose(V(cx, Math.max(heightAt(cx, cz), y - 1 + r0 * 0.9 * Math.max(0, 1 - (d / (r0 * 2.6)) ** 2) - 0.5), cz), q, V(s, s, s)); if (cn < 160) crabs.setMatrixAt(cn++, m4); }
      for (let k = 0; k < 3; k++) { const a = rr(0, TAU), d = rr(r0 * 2.2, 12); pt.push([x - w.x + Math.cos(a) * d, z - w.z + Math.sin(a) * d, rr(0.8, 2), SRr() < 0.5 ? '#a19e94' : '#a08428']); } }
    for (const im of [worms, mussels, crabs]) scene.add(im); worms.count = wn; mussels.count = mn; crabs.count = cn;
    const mats = matMesh(pt.map(([px, pz, r, c]) => [px, pz, r, c]), 0); mats.position.set(w.x, 0, w.z); scene.add(mats);
    // the mats follow the seabed: bake each patch onto its own floor height
    { const gp = mats.geometry.attributes.position; for (let k = 0; k < gp.count; k++) gp.setY(k, heightAt(gp.getX(k) + w.x, gp.getZ(k) + w.z) + 0.04); mats.geometry.computeBoundingSphere(); } }
  // the trench floor: a research lander left by an earlier expedition (its beacon blinks), glass sponges, sea lilies and sea pigs
  { const w = P0.trench, cx = w.x, cz = w.z, y0 = heightAt(cx, cz), V = (x, y, z) => new THREE.Vector3(x, y, z), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const lx = cx + 6, lz = cz - 4, ly = heightAt(lx, lz); const L = new THREE.Group(); const lp = [];
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; lp.push(P(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), '#7d8288', [Math.cos(a) * 1.2, 1.4, Math.sin(a) * 1.2], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]), P(new THREE.CylinderGeometry(0.35, 0.4, 0.1, 10), '#8a8e94', [Math.cos(a) * 1.75, 0.05, Math.sin(a) * 1.75])); }
    lp.push(P(new THREE.TorusGeometry(1.0, 0.07, 6, 18), '#7d8288', [0, 2.6, 0], [Math.PI / 2, 0, 0]), P(new THREE.BoxGeometry(1.8, 0.7, 1.8), '#f2c230', [0, 3.2, 0], [0, 0.3, 0], [1, 1, 1], (x, y, z) => (NZ(x * 3, z * 3 + y) > 0.45 ? [0.4, 0.36, 0.2] : [0.7, 0.5, 0.06])),
      P(new THREE.CylinderGeometry(0.28, 0.28, 1.5, 12), '#6d737a', [0, 1.9, 0]), P(new THREE.SphereGeometry(0.2, 10, 8), '#1a2430', [0.45, 2.4, 0.2]), P(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), '#7d8288', [0, 3.95, 0]),
      P(new THREE.BoxGeometry(0.5, 0.3, 0.02), '#d5d9de', [0, 3.2, 0.92], [0, 0.3, 0]));
    L.add(new THREE.Mesh(M(...lp), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 })));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(3), fog: false })); beacon.position.set(0, 4.45, 0); L.add(beacon);
    L.position.set(lx, ly, lz); scene.add(L); colliders.push({ x: lx, y: ly + 2.2, z: lz, r: 2.2 }); out.beacon = { pos: V(lx, ly + 4.45, lz), mesh: beacon }; out.far.push({ o: L, x: lx, z: lz });
    const spot = (n, fn) => { let k = 0, g = 0; while (k < n && g++ < n * 20) { const a = rr(0, TAU), d = Math.sqrt(SRr()) * 85 + 4, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = heightAt(x, z); if (y > y0 + 25 || Math.hypot(x - lx, z - lz) < 4) continue; fn(x, y, z); k++; } };
    // glass sponges: pale lattice vases
    const sg = new THREE.LatheGeometry([[0.05, 0], [0.16, 0.1], [0.24, 0.5], [0.28, 1.0], [0.3, 1.35], [0.36, 1.5], [0.33, 1.52]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    const sponges = new THREE.InstancedMesh(P(sg, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const a = Math.atan2(z, x); return Math.sin(a * 7 + y * 9) * Math.sin(a * 7 - y * 9) > 0.55 ? [0.7, 0.69, 0.62] : [0.4, 0.42, 0.4]; }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, transparent: true, opacity: 0.85, side: THREE.DoubleSide, emissive: 0x0e1616, emissiveIntensity: 0.6 }), 26); let n = 0;
    spot(26, (x, y, z) => { q.setFromEuler(new THREE.Euler(rr(-0.1, 0.1), rr(0, TAU), rr(-0.1, 0.1))); const s = rr(0.7, 1.4); m4.compose(V(x, y - 0.05, z), q, V(s, s * rr(0.9, 1.3), s)); sponges.setMatrixAt(n++, m4); }); sponges.count = n;
    // sea lilies: a long stalk and a crown of feathery arms
    const lil = [P(new THREE.CylinderGeometry(0.02, 0.03, 1.3, 5).translate(0, 0.65, 0), '#d8c9a0'), P(new THREE.SphereGeometry(0.07, 6, 5), '#e8b070', [0, 1.33, 0])];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; lil.push(P(new THREE.BoxGeometry(0.03, 0.42, 0.06), '#f0c080', [Math.cos(a) * 0.16, 1.5, Math.sin(a) * 0.16], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7])); }
    const lilies = new THREE.InstancedMesh(M(...lil), addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0x1a1006, emissiveIntensity: 0.5 }), 0.3), 40); n = 0;
    spot(40, (x, y, z) => { q.setFromEuler(new THREE.Euler(0, rr(0, TAU), 0)); const s = rr(0.8, 1.5); m4.compose(V(x, y - 0.05, z), q, V(s, s, s)); lilies.setMatrixAt(n++, m4); }); lilies.count = n;
    // sea pigs: plump pink sea cucumbers walking on tube feet
    const pig = [P(new THREE.SphereGeometry(0.2, 10, 8), '#e39aa4', [0, 0.16, 0], [0, 0, 0], [0.8, 0.55, 1.6], (x, y, z) => (y > 0.2 ? [0.95, 0.68, 0.72] : [0.82, 0.5, 0.56]))];
    for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) pig.push(P(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 4), '#d88c96', [sd * 0.13, 0.05, -0.18 + k * 0.18], [0, 0, sd * 0.3]));
    for (const sd of [-1, 1]) pig.push(P(new THREE.CylinderGeometry(0.012, 0.02, 0.18, 4), '#f0b0b8', [sd * 0.06, 0.34, 0.12], [0.5, 0, sd * 0.35]));
    const pigs = new THREE.InstancedMesh(M(...pig), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0.92 }), 50); n = 0;
    spot(50, (x, y, z) => { q.setFromEuler(new THREE.Euler(0, rr(0, TAU), 0)); const s = rr(0.9, 1.6); m4.compose(V(x, y, z), q, V(s, s, s)); pigs.setMatrixAt(n++, m4); }); pigs.count = n;
    for (const im of [sponges, lilies, pigs]) { im.computeBoundingSphere(); scene.add(im); out.far.push({ o: im, x: cx, z: cz }); } }
  return out;
}

// ---------------------------------------------------------------- bleached reef
// North of the base ship a patch of reef has turned white: a broken wastewater outfall pours hot, dirty
// water over it and litter smothers the corals. Built with its own generator (and without touching the
// shared footprint registry) so nothing generated after it moves.
export function buildBleach(scene, colliders, flora) {
  const B = POIS.find((p) => p.id === 'bleach'), R = lcg(90210), rnd = (a, b) => a + (b - a) * R(), pick = (a) => a[Math.floor(R() * a.length)];
  const out = { corals: [], tops: [] }, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const palette = ['#ff5d8f', '#ff8c42', '#b15cff', '#ffd166', '#ef476f', '#2ec4b6', '#c792ea', '#ff6b6b', '#f78fb3'];
  const PAL = { whip: ['#ff5a36', '#ffb000', '#e63946', '#ff7f50', '#c77dff'], bubble: ['#e6f5d0', '#ffd6e8', '#d8f3ff', '#fff3b0'], soft: ['#ff8fab', '#c77dff', '#ffd166', '#ff9e5e', '#9bf6ff', '#f15bb5'] };
  const SCALE = { whip: 1.1, soft: 1.1 }, FOOT = { branch: 0.55, stag: 0.8, brain: 0.7, fan: 0.45, soft: 0.5, bubble: 0.4, whip: 0.35 };
  const heads = []; for (let k = 0; k < 40 && heads.length < 9; k++) { const a = rnd(0, TAU), d = Math.sqrt(R()) * 36, x = B.x + Math.cos(a) * d, z = B.z + Math.sin(a) * d; if (heads.some((h) => Math.hypot(h[0] - x, h[1] - z) < 13)) continue; heads.push([x, z, rnd(5, 9)]); }
  const occ = [], free = (x, z, r) => occ.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 >= (pr + r) ** 2) && reefFree(x, z, r);
  const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), 0.4);
  for (const [name, geo, cnt] of flora.coralKinds) { const list = [], want = Math.round(cnt * 0.3);
    for (let n = 0, g = 0; n < want && g < want * 25; g++) { const c = pick(heads), a = rnd(0, TAU), d = Math.sqrt(R()) * c[2], x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d, y = heightAt(x, z);
      const sc = rnd(0.8, 2.2) * (SCALE[name] || 1), fr = sc * FOOT[name]; if (!free(x, z, fr)) continue; occ.push([x, z, fr]); n++;
      q.setFromEuler(new THREE.Euler(rnd(-0.15, 0.15), rnd(0, TAU), rnd(-0.15, 0.15))); list.push([new THREE.Matrix4().compose(V(x, y - 0.2, z), q, V(sc, sc, sc)), new THREE.Color(pick(PAL[name] || palette)), R() < 0.22]);
      if (sc > 1.3 && name !== 'whip' && name !== 'fan') out.tops.push(V(x, y + sc * 0.55, z)); }
    const im = new THREE.InstancedMesh(geo, mat, list.length), vivid = [], pale = [];
    list.forEach(([mm, c, dead], i) => { im.setMatrixAt(i, mm); vivid.push(c); pale.push(new THREE.Color(dead ? '#b3aa94' : '#f3f0e8')); im.setColorAt(i, pale[i]); });
    im.computeBoundingSphere(); scene.add(im); out.corals.push({ im, vivid, pale }); flora.reefMeshes.push(im); }
  // 0 = bleached white, 1 = fully recovered colour
  out.set = (h) => { const c = new THREE.Color(); for (const { im, vivid, pale } of out.corals) { for (let i = 0; i < im.count; i++) im.setColorAt(i, c.copy(pale[i]).lerp(vivid[i], h)); im.instanceColor.needsUpdate = true; } };
  // the outfall: a concrete pipe half-buried in the sand, running in from the north-west, with a hand-wheel valve near its broken mouth
  const dir = V(0.83, 0, 0.56), from = V(B.x - dir.x * 90, 0, B.z - dir.z * 90), mouthXZ = V(B.x - dir.x * 13, 0, B.z - dir.z * 13), parts = [];
  const pipeY = (x, z) => heightAt(x, z) + 0.45, conc = (x, y, z) => { const n = NZ(x * 0.8 + 3, z * 0.8 + y) * 0.5 + 0.5; return NZ(x * 1.7, z * 1.7 + 4) > 0.35 ? [0.28, 0.36, 0.22] : [0.42 + n * 0.12, 0.41 + n * 0.11, 0.38 + n * 0.1]; };
  const L = from.distanceTo(mouthXZ), N = Math.ceil(L / 3);
  for (let k = 0; k < N; k++) { const a = from.clone().lerp(mouthXZ, k / N), b = from.clone().lerp(mouthXZ, (k + 1) / N); a.y = pipeY(a.x, a.z); b.y = pipeY(b.x, b.z);
    const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b), g = new THREE.CylinderGeometry(0.9, 0.9, len + 0.05, 14, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())); parts.push(P(g, '#fff', [mid.x, mid.y, mid.z], [0, 0, 0], [1, 1, 1], conc));
    if (k % 2 === 0) { const f = new THREE.CylinderGeometry(1.08, 1.08, 0.35, 14); f.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())); parts.push(P(f, '#fff', [a.x, a.y, a.z], [0, 0, 0], [1, 1, 1], conc)); }
    colliders.push({ x: mid.x, y: mid.y, z: mid.z, r: 1.1 }); }
  const my = pipeY(mouthXZ.x, mouthXZ.z), up = V(0, 1, 0), dq = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const lip = new THREE.CylinderGeometry(1.0, 1.15, 0.5, 14, 1, true); lip.applyQuaternion(dq); parts.push(P(lip, '#fff', [mouthXZ.x, my, mouthXZ.z], [0, 0, 0], [1, 1, 1], (x, y, z) => rustyish(x, y, z)));
  const hole = new THREE.CircleGeometry(0.88, 14); hole.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir.clone().negate())); parts.push(P(hole, '#0a0806', [mouthXZ.x - dir.x * 0.1, my, mouthXZ.z - dir.z * 0.1]));
  const vxz = from.clone().lerp(mouthXZ, 1 - 6 / L), vy = pipeY(vxz.x, vxz.z);
  parts.push(P(new THREE.BoxGeometry(1.6, 1.0, 1.6), '#7a3a22', [vxz.x, vy + 1.1, vxz.z], [0, Math.atan2(dir.x, dir.z), 0], [1, 1, 1], rustyish), P(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 6), '#5a4a3a', [vxz.x, vy + 2.0, vxz.z]));
  const pipe = new THREE.Mesh(M(...parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })); scene.add(pipe); flora.reefMeshes.push(pipe);
  const wg = [P(new THREE.TorusGeometry(0.62, 0.07, 6, 20), '#b0321e', [0, 0, 0], [Math.PI / 2, 0, 0])]; for (let k = 0; k < 4; k++) wg.push(P(new THREE.BoxGeometry(1.2, 0.06, 0.06), '#b0321e', [0, 0, 0], [0, (k * Math.PI) / 4, 0]));
  const wheel = new THREE.Mesh(M(...wg), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x2a0600, emissiveIntensity: 0.5 })); wheel.position.set(vxz.x, vy + 2.5, vxz.z); scene.add(wheel);
  colliders.push({ x: vxz.x, y: vy + 1.2, z: vxz.z, r: 1.3 });
  out.valve = { pos: V(vxz.x, vy + 2.5, vxz.z), wheel, prog: 0 };
  // cleanup site: litter draped on the larger coral heads plus debris on the sand; the "leak" is the outfall mouth
  const tops = out.tops.slice().sort(() => R() - 0.5).slice(0, 12);
  out.site = { center: V(B.x, heightAt(B.x, B.z), B.z), r: 55, spots: tops, leaks: [V(mouthXZ.x + dir.x * 0.6, my, mouthXZ.z + dir.z * 0.6)], dir };
  return out;
}
const rustyish = (x, y, z) => { const n = NZ(x * 1.4 + 2, y * 1.4 + z) * 0.5 + 0.5; return [0.4 + n * 0.2, 0.2 + n * 0.08, 0.12 + n * 0.04]; };

// ---------------------------------------------------------------- base ship (surface)
export function buildBaseShip() {
  const g = new THREE.Group();
  const hullCol = (x, y) => (y < -1.4 ? [0.6, 0.16, 0.13] : y < -0.9 ? [0.08, 0.08, 0.09] : y > 2.6 ? [0.1, 0.23, 0.37] : [0.93, 0.95, 0.96]);
  const hull = shipHull(36, 7, 9, hullCol).rotateY(-Math.PI / 2);
  const parts = [hull,
    P(new THREE.BoxGeometry(7, 4, 10), '#f4f6f8', [0, 5, -1]), P(new THREE.BoxGeometry(6, 2.2, 6), '#e3e8ec', [0, 8.1, 1], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.abs(y - 8.2) < 0.45 && z > 2.9 ? [0.1, 0.16, 0.22] : [0.89, 0.91, 0.93])),
    P(new THREE.BoxGeometry(7.05, 0.7, 10.05), '#1c2d3f', [0, 5.6, -1]),
    P(new THREE.CylinderGeometry(0.15, 0.15, 8, 6), '#8a939b', [0, 12, 1]), P(new THREE.BoxGeometry(3, 0.15, 0.3), '#8a939b', [0, 14.5, 1]),
    P(new THREE.BoxGeometry(2, 4, 2), '#2a6fb0', [0, 6, -7.5], [0, 0, 0], [1, 1, 1], (x, y) => (Math.abs(y - 6.6) < 0.4 ? [0.25, 0.88, 0.82] : [0.16, 0.44, 0.69])),
    P(new THREE.BoxGeometry(0.6, 10, 0.6), '#e7b21c', [2.6, 7, -13]), P(new THREE.BoxGeometry(0.5, 0.5, 7), '#e7b21c', [2.6, 11.8, -16], [0.35, 0, 0]),
    P(new THREE.CapsuleGeometry(0.7, 2.6, 4, 8), '#ff7b22', [3.7, 5, 1], [0, 0, Math.PI / 2]), P(new THREE.CapsuleGeometry(0.7, 2.6, 4, 8), '#ff7b22', [-3.7, 5, 1], [0, 0, Math.PI / 2]),
  ];
  for (let z = -17; z < 16; z += 1.4) { const w = 4.4 * (z > 7 ? 1 - (z - 7) / 11 * 0.9 : 1); parts.push(P(new THREE.BoxGeometry(0.06, 1, 0.06), '#9aa2aa', [w, 4.1, z]), P(new THREE.BoxGeometry(0.06, 1, 0.06), '#9aa2aa', [-w, 4.1, z])); }
  g.add(new THREE.Mesh(M(...parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 })));
  // name plates
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#1b3a5c'; x.font = '900 64px "Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('RV 푸른바다', 256, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  for (const s of [1, -1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), nm); p.position.set(s * 4.52, 1.2, 8); p.rotation.y = s * Math.PI / 2; g.add(p); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4d0').multiplyScalar(3), fog: false })); lamp.position.set(0, 16.2, 1); g.add(lamp);
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(3), fog: false })); red.position.set(1.5, 14.6, 1); g.add(red);
  const grn = red.clone(); grn.material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#30ff60').multiplyScalar(3), fog: false }); grn.position.x = -1.5; g.add(grn);
  // crane cable to dock
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 20, 4), new THREE.MeshBasicMaterial({ color: 0x222222 })); cable.position.set(2.6, 3, -19); g.add(cable);
  return g;
}
export function buildDockRing() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.22, 10, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff9a').multiplyScalar(2), fog: false, transparent: true, opacity: 0.9 }));
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 32, 1, true).translate(0, -15, 0), new THREE.MeshBasicMaterial({ map: gradTex([[0, 'rgba(93,255,154,.16)'], [1, 'rgba(93,255,154,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  g.add(beam); g.userData.ring = ring;
  return g;
}
export { SRr };
