// Procedural low-poly models built from primitives (merged, vertex-colored).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, NZ, mulberry32 } from './util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// Transform + color a primitive so it can be merged.
export function P(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], colorFn) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e);
  _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), c = new THREE.Color(color), pa = g.attributes.position.array;
  for (let i = 0; i < n; i++) {
    let r = c.r, gg = c.g, b = c.b;
    if (colorFn) { const o = colorFn(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2], c); r = o[0]; gg = o[1]; b = o[2]; }
    arr[i * 3] = r; arr[i * 3 + 1] = gg; arr[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
export const M = (...parts) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); return g; };
export function displace(geo, amt, freq = 1.3, seed = 0) {
  const p = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = NZ(v.x * freq + seed, v.y * freq + v.z * freq * 0.7 - seed) * amt; const l = v.length() || 1; v.multiplyScalar(1 + n / l); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
const shapeGeo = (pts) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))));
export const vFin = (pts) => shapeGeo(pts).rotateY(-Math.PI / 2); // (forward z, up y)
export const hFin = (pts) => shapeGeo(pts).rotateX(Math.PI / 2); // (side x, forward z)
export function lathe(profile, seg = 16) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg).rotateX(Math.PI / 2); }
const col = (h) => new THREE.Color(h);
const topBottom = (top, bottom, split = 0, soft = 0.15) => { const a = col(top), b = col(bottom); return (x, y) => { const t = THREE.MathUtils.smoothstep(y, split - soft, split + soft); return [b.r + (a.r - b.r) * t, b.g + (a.g - b.g) * t, b.b + (a.b - b.b) * t]; }; };

export const MAT = {};
export function initMaterials() {
  MAT.vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  MAT.vcD = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
  MAT.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, emissive: 0x0a3a50, emissiveIntensity: 0.6 });
  MAT.bag = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  MAT.net = new THREE.MeshBasicMaterial({ color: 0x7fd0c0, wireframe: true, transparent: true, opacity: 0.85 });
  MAT.gold = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.7, emissive: 0x6a4a00, emissiveIntensity: 0.35 });
  MAT.bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.9 });
  MAT.glowCyan = new THREE.MeshBasicMaterial({ color: 0xa8fbff, fog: false });
  MAT.glowCyan.color.multiplyScalar(2.2);
}

// ---------------------------------------------------------------- submarine
export function buildSub() {
  const Y = '#ffcf2e', Yd = '#f0b000', D = '#27313b', G = '#8a96a2';
  const body = M(
    P(new THREE.CapsuleGeometry(0.85, 2.2, 8, 20), Y, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1], (x, y) => { const t = THREE.MathUtils.smoothstep(y, -0.9, 0.9); return [0.85 + 0.15 * t, 0.52 + 0.2 * t, 0.02 + 0.04 * t]; }),
    P(new THREE.CylinderGeometry(0.44, 0.5, 0.6, 16), Yd, [0, 0.95, 0.15], [0, 0, 0], [1, 1, 1.5]),
    P(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), G, [0.15, 1.45, 0.35]),
    P(new THREE.BoxGeometry(0.1, 0.1, 0.3), G, [0.15, 1.72, 0.45]),
    P(new THREE.CylinderGeometry(0.875, 0.875, 0.22, 24, 1, true), D, [0, 0, -0.4], [Math.PI / 2, 0, 0]),
    P(new THREE.BoxGeometry(0.08, 1.3, 0.7), Yd, [0, 0, -1.75]),
    P(new THREE.BoxGeometry(1.3, 0.08, 0.7), Yd, [0, 0, -1.75]),
    P(new THREE.TorusGeometry(0.62, 0.09, 8, 20), G, [0, 0, -2.15]),
    P(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 10), D, [0, 0, -2.0], [Math.PI / 2, 0, 0]),
    P(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 12), D, [0.55, -0.42, 1.25], [Math.PI / 2, 0, 0]),
    P(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 12), D, [-0.55, -0.42, 1.25], [Math.PI / 2, 0, 0]),
    P(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), G, [0, -0.95, 0.6], [0.9, 0, 0]),
    P(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), G, [0, -1.15, 1.15], [-0.4, 0, 0]),
    P(new THREE.TorusGeometry(0.16, 0.04, 6, 12), D, [0.84, 0.15, 0.3], [0, Math.PI / 2, 0]),
    P(new THREE.TorusGeometry(0.16, 0.04, 6, 12), D, [-0.84, 0.15, 0.3], [0, Math.PI / 2, 0]),
    P(new THREE.TorusGeometry(0.16, 0.04, 6, 12), D, [0.84, 0.15, -0.35], [0, Math.PI / 2, 0]),
    P(new THREE.TorusGeometry(0.16, 0.04, 6, 12), D, [-0.84, 0.15, -0.35], [0, Math.PI / 2, 0]),
  );
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.12, emissive: 0x2a1a00, emissiveIntensity: 0.6 })); g.add(bodyMesh);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), MAT.glass); dome.position.z = 1.35; g.add(dome);
  const ports = new THREE.Mesh(M(P(new THREE.SphereGeometry(0.13, 8, 6), '#8fe6ff', [0.82, 0.15, 0.3]), P(new THREE.SphereGeometry(0.13, 8, 6), '#8fe6ff', [-0.82, 0.15, 0.3]), P(new THREE.SphereGeometry(0.13, 8, 6), '#8fe6ff', [0.82, 0.15, -0.35]), P(new THREE.SphereGeometry(0.13, 8, 6), '#8fe6ff', [-0.82, 0.15, -0.35])), new THREE.MeshBasicMaterial({ vertexColors: true }));
  g.add(ports);
  const lamps = new THREE.Mesh(M(P(new THREE.CircleGeometry(0.12, 12), '#fff', [0.55, -0.42, 1.41]), P(new THREE.CircleGeometry(0.12, 12), '#fff', [-0.55, -0.42, 1.41])), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  lamps.material.color.setScalar(3); g.add(lamps);
  const prop = new THREE.Mesh(M(...[0, 1, 2].map((i) => P(new THREE.BoxGeometry(0.16, 0.95, 0.04), '#c9d2d8', [0, 0, 0], [0, 0.5, (i * TAU) / 3]))), MAT.metal);
  prop.position.z = -2.15; g.add(prop);
  return { root: g, prop, lamps, bodyMesh };
}

// ---------------------------------------------------------------- trash & treasure
function bottleGeo(bodyCol, capCol, label) {
  return M(
    P(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 12), bodyCol, [0, 0, 0]),
    P(new THREE.CylinderGeometry(0.07, 0.17, 0.18, 12), bodyCol, [0, 0.4, 0]),
    P(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 10), bodyCol, [0, 0.54, 0]),
    P(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10), capCol, [0, 0.62, 0]),
    ...(label ? [P(new THREE.CylinderGeometry(0.175, 0.175, 0.24, 12, 1, true), label, [0, -0.02, 0])] : []),
  ).rotateZ(Math.PI / 2);
}
export function buildTrashGeos() {
  const G = {};
  G.bottle = bottleGeo('#a8def5', '#1e7be0', '#e8453c');
  G.glass = bottleGeo('#2f8f4c', '#b38b5a', '#e9dcb0');
  G.can = M(P(new THREE.CylinderGeometry(0.14, 0.14, 0.44, 14), '#d62d20', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => (Math.abs(y) > 0.17 ? [0.78, 0.8, 0.82] : [0.84, 0.18, 0.13])), P(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10), '#bfc6cc', [0, 0.23, 0])).rotateZ(Math.PI / 2).scale(1, 0.8, 1);
  G.bag = displace(P(new THREE.IcosahedronGeometry(0.55, 2), '#eef2f6', [0, 0, 0], [0, 0, 0], [1, 0.75, 0.9]), 0.18, 2.4, 3);
  G.mask = M(P(new THREE.BoxGeometry(0.55, 0.04, 0.34), '#9fd3ea'), P(new THREE.TorusGeometry(0.16, 0.012, 4, 12), '#f2f6f8', [0.36, 0, 0], [Math.PI / 2, 0, 0]), P(new THREE.TorusGeometry(0.16, 0.012, 4, 12), '#f2f6f8', [-0.36, 0, 0], [Math.PI / 2, 0, 0]));
  G.styro = displace(P(new THREE.BoxGeometry(0.7, 0.4, 0.5, 3, 2, 2), '#f5f3ec'), 0.06, 3, 1);
  G.cup = M(P(new THREE.CylinderGeometry(0.15, 0.1, 0.36, 12), '#e4eff5', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => (y < 0 ? [0.47, 0.31, 0.16] : [0.9, 0.94, 0.96])), P(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12), '#ffffff', [0, 0.2, 0]), P(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), '#4caf50', [0.04, 0.35, 0], [0, 0, 0.3]));
  G.rope = M(...[0, 1, 2, 3].map((i) => P(new THREE.TorusGeometry(0.42 - i * 0.07, 0.06, 6, 20), i % 2 ? '#c96a1a' : '#e8892b', [0, i * 0.08, 0], [Math.PI / 2, 0, i])));
  G.tire = M(P(new THREE.TorusGeometry(0.72, 0.3, 10, 26), '#1b1b1e', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const a = Math.atan2(y, x); const t = Math.sin(a * 22) > 0.3 && Math.hypot(x, y) > 0.9 ? 0.05 : 0.11; return [t, t, t + 0.01]; }), P(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16), '#4a4f55', [0, 0, 0], [Math.PI / 2, 0, 0]));
  const bars = [];
  for (let i = -3; i <= 3; i++) bars.push(P(new THREE.BoxGeometry(0.03, 0.03, 1.5), '#a9b1b8', [i * 0.18, 0.2, 0]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [i * 0.18, 0.5, 0.75]));
  for (let j = -3; j <= 3; j++) bars.push(P(new THREE.BoxGeometry(1.1, 0.03, 0.03), '#a9b1b8', [0, 0.2, j * 0.22]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [0.55, 0.5, j * 0.22]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [-0.55, 0.5, j * 0.22]));
  bars.push(P(new THREE.BoxGeometry(1.1, 0.05, 0.05), '#d33c2f', [0, 0.95, -0.85]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [0.45, -0.25, 0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [-0.45, -0.25, 0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [0.45, -0.25, -0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [-0.45, -0.25, -0.6], [0, 0, Math.PI / 2]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [0.45, 0, 0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [-0.45, 0, 0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [0.45, 0, -0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [-0.45, 0, -0.6]));
  G.cart = M(...bars).translate(0, -0.3, 0);
  G.ewaste = M(P(new THREE.BoxGeometry(0.36, 0.05, 0.7), '#1c1d21'), P(new THREE.BoxGeometry(0.3, 0.01, 0.6), '#1d4a70', [0, 0.03, 0]), P(new THREE.BoxGeometry(0.45, 0.03, 0.32), '#1f7a3a', [0.35, 0, 0.2], [0, 0.4, 0]), P(new THREE.BoxGeometry(0.1, 0.04, 0.1), '#111', [0.35, 0.03, 0.2]));
  G.battery = M(P(new THREE.BoxGeometry(0.85, 0.5, 0.45), '#2b2f36'), P(new THREE.BoxGeometry(0.85, 0.08, 0.46), '#ffc93a', [0, -0.05, 0]), P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), '#d63b2f', [0.28, 0.3, 0]), P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), '#222', [-0.28, 0.3, 0]));
  G.drum = M(P(new THREE.CylinderGeometry(0.62, 0.62, 1.75, 18), '#e8b92a', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const r = NZ(x * 3, y * 3 + z * 2); if (r > 0.25) return [0.45, 0.22, 0.08]; if (Math.abs(Math.abs(y) - 0.45) < 0.06) return [0.3, 0.24, 0.05]; if (Math.abs(y) < 0.2 && z > 0.3 && Math.abs(x) < 0.3) return [0.05, 0.05, 0.05]; return [0.91, 0.72, 0.16]; }), P(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 18), '#9c8a50', [0, 0.88, 0]));
  G.scrap = M(displace(P(new THREE.BoxGeometry(2.2, 0.16, 1.4, 6, 1, 4), '#8a5230', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const n = NZ(x * 2, z * 2) * 0.5 + 0.5; return [0.35 + 0.25 * n, 0.2 + 0.1 * n, 0.1 + 0.05 * n]; }), 0.15, 1.2, 7), P(new THREE.BoxGeometry(0.2, 0.2, 1.8), '#5b3a26', [0.6, 0.2, 0], [0.3, 0.4, 0]));
  const cont = [P(new THREE.BoxGeometry(7.2, 2.6, 2.6), '#ffffff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const rib = Math.sin(x * 9) > 0.6 ? 0.78 : 0.92; const rust = NZ(x * 0.8, y + z) > 0.3 ? 0.6 : 1; return [rib * rust, rib * rust * 0.95, rib * rust * 0.95]; })];
  cont.push(P(new THREE.BoxGeometry(0.06, 2.4, 0.06), '#555555', [3.62, 0, 0.5]), P(new THREE.BoxGeometry(0.06, 2.4, 0.06), '#555555', [3.62, 0, -0.5]));
  G.container = M(...cont);
  G.net = displace(new THREE.IcosahedronGeometry(1.5, 1), 0.35, 1.5, 4);
  // treasures
  G.T_chest = M(P(new THREE.BoxGeometry(1.4, 0.8, 0.9), '#6b3f1f'), P(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 12, 1, false, 0, Math.PI), '#7d4a25', [0, 0.4, 0], [0, 0, Math.PI / 2]), P(new THREE.BoxGeometry(1.42, 0.1, 0.92), '#e0b030', [0, 0.35, 0]), P(new THREE.BoxGeometry(0.12, 1.2, 0.94), '#e0b030', [0.5, 0.2, 0]), P(new THREE.BoxGeometry(0.12, 1.2, 0.94), '#e0b030', [-0.5, 0.2, 0]), P(new THREE.BoxGeometry(0.2, 0.25, 0.1), '#f5d25a', [0, 0.3, 0.47]));
  G.T_coin = M(P(new THREE.SphereGeometry(0.45, 12, 10), '#8b5a2b', [0, 0.1, 0], [0, 0, 0], [1, 1.1, 1]), P(new THREE.CylinderGeometry(0.15, 0.2, 0.2, 10), '#6a4020', [0, 0.6, 0]), ...[0, 1, 2, 3, 4].map((i) => P(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 14), '#f2c230', [0.5 + (i % 2) * 0.2, -0.3 + i * 0.03, -0.3 + i * 0.15], [0.3 * i, 0, 0.2])));
  G.T_pearl = M(P(new THREE.SphereGeometry(0.6, 16, 8, 0, TAU, 0, Math.PI / 2), '#8c7a9a', [0, 0, 0], [Math.PI, 0, 0], [1, 0.35, 0.9]), P(new THREE.SphereGeometry(0.6, 16, 8, 0, TAU, 0, Math.PI / 2), '#b3a2c4', [0, 0.05, -0.35], [-1.0, 0, 0], [1, 0.35, 0.9]), P(new THREE.SphereGeometry(0.2, 14, 10), '#e8e8f8', [0, 0.12, 0.1]));
  G.T_vase = P(new THREE.LatheGeometry([[0.01, -0.8], [0.25, -0.75], [0.5, -0.3], [0.55, 0.1], [0.3, 0.5], [0.18, 0.7], [0.24, 0.85], [0.01, 0.86]].map(([a, b]) => new THREE.Vector2(a, b)), 16), '#c9713e', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => (Math.abs(y - 0.1) < 0.05 || Math.abs(y + 0.2) < 0.03 ? [0.12, 0.06, 0.03] : [0.78, 0.44, 0.24]));
  G.T_compass = M(P(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 20), '#c9a13a'), P(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 20), '#f3ead0', [0, 0.07, 0]), P(new THREE.BoxGeometry(0.06, 0.02, 0.5), '#c0392b', [0, 0.09, 0]));
  G.T_idol = M(P(new THREE.SphereGeometry(0.2, 12, 10), '#f0c030', [0, 0.55, 0]), P(new THREE.CylinderGeometry(0.2, 0.35, 0.7, 8), '#e2b020', [0, 0.05, 0]), P(new THREE.BoxGeometry(0.6, 0.15, 0.4), '#c89818', [0, -0.35, 0]));
  return G;
}

// ---------------------------------------------------------------- small fish (instanced)
export function fishGeo(kind) {
  const L = { sardine: 0.45, lantern: 0.4, clownfish: 0.4, tang: 0.55, reef: 0.34 }[kind];
  const H = { sardine: 0.13, lantern: 0.12, clownfish: 0.2, tang: 0.34, reef: 0.2 }[kind];
  const W = { sardine: 0.09, lantern: 0.08, clownfish: 0.12, tang: 0.08, reef: 0.07 }[kind];
  const cfn = {
    sardine: (x, y) => (y > 0.01 ? [0.17, 0.33, 0.5] : [0.85, 0.9, 0.93]),
    lantern: (x, y) => (y > 0 ? [0.08, 0.1, 0.14] : [0.2, 0.24, 0.3]),
    clownfish: (x, y, z) => { const zz = z / L; const band = [0.22, -0.02, -0.28].some((b) => Math.abs(zz - b) < 0.05); const edge = [0.22, -0.02, -0.28].some((b) => Math.abs(zz - b) < 0.075); return band ? [1, 1, 1] : edge ? [0.05, 0.05, 0.05] : [1, 0.45, 0.07]; },
    reef: (x, y) => (y > 0.03 ? [0.78, 0.78, 0.8] : [1, 1, 1]), // tinted per fish by instance colour
    tang: (x, y, z) => (z < -L * 0.42 ? [1, 0.82, 0.2] : y > H * 0.1 && z < L * 0.1 && z > -L * 0.3 ? [0.05, 0.08, 0.2] : [0.12, 0.38, 0.9]),
  }[kind];
  const body = P(new THREE.SphereGeometry(0.5, 12, 8), '#fff', [0, 0, 0], [0, 0, 0], [W, H, L], cfn);
  const tail = P(vFin([[-L * 0.42, 0], [-L * 0.72, H * 0.55], [-L * 0.66, 0], [-L * 0.72, -H * 0.55]]), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => cfn(x, y, -L * 0.6));
  const dorsal = P(vFin([[L * 0.15, H * 0.42], [-L * 0.1, H * 0.8], [-L * 0.3, H * 0.3]]), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => cfn(x, y, z));
  const eyes = [P(new THREE.SphereGeometry(Math.max(0.02, H * 0.12), 6, 4), '#050505', [W * 0.42, H * 0.08, L * 0.32]), P(new THREE.SphereGeometry(Math.max(0.02, H * 0.12), 6, 4), '#050505', [-W * 0.42, H * 0.08, L * 0.32])];
  return M(body, tail, dorsal, ...eyes);
}
export function lanternDotsGeo() {
  const g = []; for (let i = 0; i < 4; i++) g.push(P(new THREE.SphereGeometry(0.025, 5, 4), '#fff', [0.045, -0.035, 0.12 - i * 0.08]), P(new THREE.SphereGeometry(0.025, 5, 4), '#fff', [-0.045, -0.035, 0.12 - i * 0.08]));
  return M(...g);
}

// ---------------------------------------------------------------- creatures
// Each builder returns {root, anim(t,e)} ; models face +Z.
function chain(n, segLen, rad0, rad1, color, mat) {
  const root = new THREE.Group(); let parent = root; const joints = [];
  for (let i = 0; i < n; i++) {
    const r = rad0 + (rad1 - rad0) * (i / n);
    const j = new THREE.Group(); if (i > 0) j.position.z = -segLen; parent.add(j); joints.push(j);
    const m = new THREE.Mesh(P(new THREE.CapsuleGeometry(r, segLen, 3, 6), color, [0, 0, -segLen / 2], [Math.PI / 2, 0, 0]), mat); j.add(m);
    parent = j;
  }
  return { root, joints };
}
export const BUILD = {
  turtle() {
    const g = new THREE.Group();
    const shellCol = (x, y, z) => { const n = Math.sin(x * 9) * Math.sin(z * 7); return n > 0.3 ? [0.55, 0.42, 0.22] : [0.36, 0.26, 0.12]; };
    g.add(new THREE.Mesh(M(
      P(new THREE.SphereGeometry(0.75, 18, 12), '#fff', [0, 0.1, 0], [0, 0, 0], [1, 0.42, 1.25], shellCol),
      P(new THREE.SphereGeometry(0.75, 16, 8), '#d8c79a', [0, 0.02, 0], [0, 0, 0], [0.95, 0.16, 1.18]),
      P(new THREE.SphereGeometry(0.25, 12, 10), '#6b9a52', [0, 0.1, 1.1], [0, 0, 0], [0.9, 0.8, 1.3]),
      P(new THREE.SphereGeometry(0.045, 6, 4), '#111', [0.15, 0.17, 1.22]), P(new THREE.SphereGeometry(0.045, 6, 4), '#111', [-0.15, 0.17, 1.22]),
    ), MAT.vc));
    const fl = [];
    for (const [sx, z, big] of [[1, 0.5, 1], [-1, 0.5, 1], [1, -0.75, 0], [-1, -0.75, 0]]) {
      const piv = new THREE.Group(); piv.position.set(sx * 0.6, 0.02, z);
      piv.add(new THREE.Mesh(P(new THREE.SphereGeometry(0.5, 10, 6), '#5f8c4a', [sx * (big ? 0.45 : 0.25), 0, big ? -0.1 : -0.05], [0, sx * 0.5, 0], big ? [0.95, 0.08, 0.34] : [0.5, 0.07, 0.25]), MAT.vc));
      g.add(piv); fl.push([piv, sx, big]);
    }
    return { root: g, anim(t) { for (const [p, sx, big] of fl) { const a = Math.sin(t * 2.2 + (big ? 0 : 1)) * (big ? 0.55 : 0.3); p.rotation.z = sx * a; p.rotation.y = sx * Math.cos(t * 2.2) * 0.25; } } };
  },
  shark() {
    const g = new THREE.Group();
    const tb = topBottom('#5c6f80', '#e6ecef', -0.05, 0.12);
    g.add(new THREE.Mesh(M(
      P(lathe([[0, -1.8], [0.12, -1.55], [0.26, -1.05], [0.42, -0.4], [0.46, 0.2], [0.4, 0.85], [0.24, 1.4], [0.06, 1.75], [0, 1.78]], 16), '#fff', [0, 0, 0], [0, 0, 0], [0.78, 0.9, 1], tb),
      P(vFin([[0.25, 0.3], [-0.2, 1.05], [-0.55, 0.32]]), '#4e6070'),
      P(hFin([[0.3, 0.55], [1.15, -0.05], [0.25, 0.2]]), '#4e6070', [0, -0.2, 0]), P(hFin([[-0.3, 0.55], [-1.15, -0.05], [-0.25, 0.2]]), '#4e6070', [0, -0.2, 0]),
      P(new THREE.SphereGeometry(0.06, 6, 4), '#050505', [0.26, 0.1, 1.3]), P(new THREE.SphereGeometry(0.06, 6, 4), '#050505', [-0.26, 0.1, 1.3]),
    ), MAT.vcD));
    const tail = new THREE.Group(); tail.position.z = -1.6;
    tail.add(new THREE.Mesh(M(P(vFin([[0, 0.05], [-0.75, 0.95], [-0.45, 0], [-0.6, -0.55], [0, -0.05]]), '#4e6070')), MAT.vcD));
    g.add(tail);
    return { root: g, anim(t, e) { tail.rotation.y = Math.sin(t * (e && e.state === 1 ? 10 : 5)) * 0.4; } };
  },
  manta() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(M(
      P(new THREE.SphereGeometry(0.6, 14, 10), '#22324a', [0, 0, 0], [0, 0, 0], [1.3, 0.3, 1.2], topBottom('#22324a', '#e8eef2', 0, 0.05)),
      P(new THREE.ConeGeometry(0.12, 0.6, 6), '#22324a', [0.35, 0, 0.85], [Math.PI / 2, 0, 0]), P(new THREE.ConeGeometry(0.12, 0.6, 6), '#22324a', [-0.35, 0, 0.85], [Math.PI / 2, 0, 0]),
      P(new THREE.CylinderGeometry(0.03, 0.01, 2.2, 5), '#22324a', [0, 0, -1.7], [Math.PI / 2, 0, 0]),
    ), MAT.vc));
    const wings = [];
    for (const sx of [1, -1]) { const p = new THREE.Group(); p.position.x = sx * 0.55; p.add(new THREE.Mesh(P(hFin([[0, 0.6], [sx * 2.7, -0.25], [sx * 0.2, -0.75]]), '#1d2b3c'), MAT.vcD)); g.add(p); wings.push([p, sx]); }
    return { root: g, anim(t) { for (const [p, sx] of wings) p.rotation.z = sx * Math.sin(t * 1.5) * 0.5; } };
  },
  whale() {
    const g = new THREE.Group(); const L = 7;
    const tb = topBottom('#2e4156', '#c9d2d8', -0.35, 0.3);
    const knobs = []; for (let i = 0; i < 8; i++) knobs.push(P(new THREE.SphereGeometry(0.12, 6, 4), '#3c526a', [((i % 2) - 0.5) * 0.5, 0.95 - i * 0.02, 5.9 - i * 0.35]));
    g.add(new THREE.Mesh(M(
      P(lathe([[0, -L], [0.35, -6.2], [0.8, -4.5], [1.35, -2], [1.55, 0.5], [1.5, 3], [1.15, 5], [0.6, 6.4], [0, 6.8]], 20), '#fff', [0, 0, 0], [0, 0, 0], [1, 0.95, 1], (x, y, z) => { const c = tb(x, y, z); if (y < -0.5 && Math.sin(x * 14) > 0.7) return [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7]; return c; }),
      P(vFin([[-1.5, 1.2], [-2.3, 1.8], [-2.8, 1.25]]), '#2e4156'), ...knobs,
      P(new THREE.SphereGeometry(0.1, 6, 4), '#050505', [0.95, 0.1, 4.2]), P(new THREE.SphereGeometry(0.1, 6, 4), '#050505', [-0.95, 0.1, 4.2]),
    ), MAT.vcD));
    const fins = [];
    for (const sx of [1, -1]) { const p = new THREE.Group(); p.position.set(sx * 1.2, -0.6, 3); p.add(new THREE.Mesh(P(hFin([[0, 0.4], [sx * 4.2, -1.4], [sx * 4.4, -1.8], [0, -0.5]]), '#b8c4cc'), MAT.vcD)); g.add(p); fins.push([p, sx]); }
    const fl = new THREE.Group(); fl.position.z = -6.6; fl.add(new THREE.Mesh(P(hFin([[0, 0.3], [2.4, -0.6], [1.6, -1.1], [0, -0.4], [-1.6, -1.1], [-2.4, -0.6]]), '#2e4156'), MAT.vcD)); g.add(fl);
    return { root: g, anim(t) { fl.rotation.x = Math.sin(t * 0.9) * 0.35; for (const [p, sx] of fins) { p.rotation.z = sx * (-0.35 + Math.sin(t * 0.7) * 0.2); } } };
  },
  dolphin() {
    const g = new THREE.Group(); const tb = topBottom('#6f8497', '#e2eaef', -0.08, 0.1);
    g.add(new THREE.Mesh(M(
      P(lathe([[0, -1.2], [0.12, -0.95], [0.26, -0.4], [0.32, 0.2], [0.27, 0.7], [0.12, 0.95], [0.07, 1.25], [0, 1.3]], 14), '#fff', [0, 0, 0], [0, 0, 0], [0.85, 1, 1], tb),
      P(vFin([[0.05, 0.25], [-0.35, 0.72], [-0.4, 0.25]]), '#5d7185'),
      P(hFin([[0.2, 0.45], [0.55, 0.1], [0.2, 0.25]]), '#5d7185', [0, -0.15, 0]), P(hFin([[-0.2, 0.45], [-0.55, 0.1], [-0.2, 0.25]]), '#5d7185', [0, -0.15, 0]),
      P(new THREE.SphereGeometry(0.04, 6, 4), '#050505', [0.2, 0.08, 0.8]), P(new THREE.SphereGeometry(0.04, 6, 4), '#050505', [-0.2, 0.08, 0.8]),
    ), MAT.vcD));
    const fl = new THREE.Group(); fl.position.z = -1.15; fl.add(new THREE.Mesh(P(hFin([[0, 0.1], [0.55, -0.25], [0.35, -0.4], [0, -0.15], [-0.35, -0.4], [-0.55, -0.25]]), '#5d7185'), MAT.vcD)); g.add(fl);
    return { root: g, anim(t) { fl.rotation.x = Math.sin(t * 7) * 0.45; } };
  },
  jelly(e) {
    const g = new THREE.Group(); const hue = e ? e.hue : 300; const c = new THREE.Color().setHSL(hue / 360, 0.85, 0.65);
    const bellMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, roughness: 0.2 });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 10, 0, TAU, 0, Math.PI * 0.5), bellMat); g.add(bell);
    const coreMat = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), fog: false, transparent: true, opacity: 0.9 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), coreMat); core.position.y = 0.3; core.scale.y = 0.7; g.add(core);
    const NT = 10, NS = 8; const pos = new Float32Array(NT * NS * 2 * 3);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: c.clone().multiplyScalar(1.6), transparent: true, opacity: 0.6, fog: true }));
    lines.frustumCulled = false; g.add(lines);
    return { root: g, glow: c, anim(t, ee, near) {
      const p = Math.sin(t * 3), sx = 1 + p * 0.12, sy = 1 - p * 0.12; bell.scale.set(sx, sy, sx);
      if (!near) return;
      let k = 0;
      for (let i = 0; i < NT; i++) { const a = (i / NT) * TAU, r = i < 8 ? 0.62 * sx : 0.15; let x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0;
        for (let s = 0; s < NS; s++) { const nx = x + Math.sin(t * 2 + i + s * 0.8) * 0.06, nz = z + Math.cos(t * 1.7 + i * 1.3 + s * 0.7) * 0.06, ny = y - (i < 8 ? 0.32 : 0.22);
          pos[k++] = x; pos[k++] = y; pos[k++] = z; pos[k++] = nx; pos[k++] = ny; pos[k++] = nz; x = nx; y = ny; z = nz; } }
      lg.attributes.position.needsUpdate = true; } };
  },
  angler() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(M(
      displace(P(new THREE.SphereGeometry(0.55, 16, 12), '#2b1e24', [0, 0, 0], [0, 0, 0], [0.9, 0.85, 1]), 0.04, 5),
      P(new THREE.ConeGeometry(0.3, 0.6, 4), '#2b1e24', [0, 0, -0.7], [-Math.PI / 2, 0, 0], [0.2, 1, 1]),
      P(new THREE.SphereGeometry(0.07, 6, 4), '#9fb8c0', [0.25, 0.2, 0.35]), P(new THREE.SphereGeometry(0.07, 6, 4), '#9fb8c0', [-0.25, 0.2, 0.35]),
      ...[0, 1, 2, 3, 4, 5].map((i) => P(new THREE.ConeGeometry(0.03, 0.14, 4), '#ece6da', [(i - 2.5) * 0.08, -0.05, 0.5], [Math.PI, 0, 0])),
      P(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.45, 0.15), new THREE.Vector3(0, 1.1, 0.5), new THREE.Vector3(0, 0.55, 1.0)), 10, 0.02, 4), '#3a2a30'),
    ), MAT.vc));
    const jaw = new THREE.Group(); jaw.position.set(0, -0.12, 0.1);
    jaw.add(new THREE.Mesh(M(P(new THREE.SphereGeometry(0.45, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), '#34252a', [0, 0, 0.1], [0, 0, 0], [0.85, 0.6, 1]), ...[0, 1, 2, 3, 4].map((i) => P(new THREE.ConeGeometry(0.03, 0.14, 4), '#ece6da', [(i - 2) * 0.09, 0.05, 0.45]))), MAT.vc));
    g.add(jaw);
    const lure = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), MAT.glowCyan); lure.position.set(0, 0.55, 1.02); g.add(lure);
    return { root: g, lure, anim(t, e) { jaw.rotation.x = 0.1 + (Math.sin(t * 1.3) + 1) * 0.12 + (e && e.state === 1 ? 0.5 : 0); lure.position.y = 0.55 + Math.sin(t * 2) * 0.04; } };
  },
  squid() {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(M(
      P(lathe([[0.55, 0], [0.62, 0.8], [0.55, 2], [0.35, 3.2], [0.1, 4.0], [0, 4.1]], 16), '#fff', [0, 0, 0.3], [0, 0, 0], [1, 0.9, 1], (x, y, z) => (NZ(x * 4, z * 3) > 0.2 ? [0.45, 0.1, 0.1] : [0.72, 0.22, 0.2])),
      P(hFin([[0, 3.0], [1.2, 3.9], [0, 4.4], [-1.2, 3.9]]), '#8a2c2c', [0, 0, 0.3]),
      P(new THREE.SphereGeometry(0.55, 14, 10), '#8f2e2c', [0, 0, 0], [0, 0, 0], [1, 0.95, 0.9]),
      P(new THREE.SphereGeometry(0.24, 12, 10), '#f0e6d0', [0.42, 0.08, 0]), P(new THREE.SphereGeometry(0.24, 12, 10), '#f0e6d0', [-0.42, 0.08, 0]),
      P(new THREE.SphereGeometry(0.16, 10, 8), '#08080c', [0.52, 0.09, 0.02]), P(new THREE.SphereGeometry(0.16, 10, 8), '#08080c', [-0.52, 0.09, 0.02]),
    ), mat));
    const arms = [];
    for (let i = 0; i < 10; i++) { const long = i >= 8; const ch = chain(long ? 14 : 8, long ? 0.45 : 0.35, long ? 0.07 : 0.12, 0.03, i % 2 ? '#7a2424' : '#8f2e2c', MAT.vc);
      const a = (i / 8) * TAU; ch.root.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.35); if (long) ch.root.position.set(i === 8 ? 0.2 : -0.2, -0.1, -0.35); g.add(ch.root); arms.push([ch, i, a]); }
    return { root: g, anim(t) { for (const [ch, i, a] of arms) ch.joints.forEach((j, k) => { j.rotation.x = Math.sin(t * 1.8 + k * 0.55 + i) * 0.16 + (i < 8 ? Math.sin(a) * 0.05 : 0); j.rotation.y = Math.cos(t * 1.4 + k * 0.5 + i * 1.3) * 0.14 + (i < 8 ? -Math.cos(a) * 0.05 : 0); }); } };
  },
  octopus(e) {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: e ? e.col : 0xc0553a, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), mat); head.scale.set(1, 1.2, 1.15); head.position.set(0, 0.45, -0.25); head.rotation.x = -0.6; g.add(head);
    const eyes = new THREE.Mesh(M(P(new THREE.SphereGeometry(0.08, 8, 6), '#fff3c8', [0.22, 0.28, 0.15]), P(new THREE.SphereGeometry(0.08, 8, 6), '#fff3c8', [-0.22, 0.28, 0.15])), MAT.vc); g.add(eyes);
    const arms = [];
    for (let i = 0; i < 8; i++) { const ch = chain(6, 0.22, 0.09, 0.025, '#ffffff', mat); const a = (i / 8) * TAU; ch.root.position.set(Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2); ch.root.rotation.set(-0.3, -a - Math.PI / 2, 0, 'YXZ'); g.add(ch.root); arms.push([ch, i]); }
    return { root: g, mat, anim(t) { for (const [ch, i] of arms) ch.joints.forEach((j, k) => { j.rotation.x = -0.05 + Math.sin(t * 2 + i * 1.3 + k * 0.7) * 0.25; j.rotation.y = Math.cos(t * 1.5 + i + k) * 0.12; }); } };
  },
  crab() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(M(P(new THREE.SphereGeometry(0.35, 14, 8), '#d4502c', [0, 0.15, 0], [0, 0, 0], [1, 0.45, 0.75]),
      P(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 4), '#b8401f', [0.1, 0.32, 0.18]), P(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 4), '#b8401f', [-0.1, 0.32, 0.18]),
      P(new THREE.SphereGeometry(0.04, 6, 4), '#111', [0.1, 0.42, 0.18]), P(new THREE.SphereGeometry(0.04, 6, 4), '#111', [-0.1, 0.42, 0.18]),
      P(new THREE.SphereGeometry(0.13, 8, 6), '#e0603a', [0.38, 0.18, 0.35], [0, 0, 0], [1, 0.7, 1.3]), P(new THREE.SphereGeometry(0.13, 8, 6), '#e0603a', [-0.38, 0.18, 0.35], [0, 0, 0], [1, 0.7, 1.3])), MAT.vc));
    const legs = [];
    for (let i = 0; i < 3; i++) for (const sx of [1, -1]) { const p = new THREE.Group(); p.position.set(sx * 0.25, 0.12, 0.12 - i * 0.14); p.add(new THREE.Mesh(P(new THREE.CylinderGeometry(0.025, 0.02, 0.4, 4), '#b8401f', [sx * 0.18, -0.02, 0], [0, 0, sx * 1.1]), MAT.vc)); g.add(p); legs.push([p, sx, i]); }
    return { root: g, anim(t, e) { const w = e && Math.abs(e.walk || 0) > 0 ? 1 : 0.1; for (const [p, sx, i] of legs) p.rotation.z = sx * Math.sin(t * 12 + i * 2 + (sx > 0 ? 0 : 1)) * 0.3 * w; } };
  },
  seahorse() {
    const g = new THREE.Group(); const parts = [];
    for (let i = 0; i < 12; i++) { const s = i / 11; const y = 0.5 - s * 1.0; const z = Math.sin(s * 3.2) * 0.14 - (s > 0.75 ? (s - 0.75) * 0.8 : 0); parts.push(P(new THREE.SphereGeometry(0.12 * (1 - s * 0.65) + 0.02, 8, 6), '#e8a13a', [0, y, z])); }
    parts.push(P(new THREE.SphereGeometry(0.12, 10, 8), '#e8a13a', [0, 0.62, 0.04], [0, 0, 0], [0.9, 0.85, 1.1]), P(new THREE.CylinderGeometry(0.035, 0.05, 0.25, 6), '#d8912a', [0, 0.6, 0.2], [Math.PI / 2 - 0.3, 0, 0]), P(new THREE.SphereGeometry(0.03, 5, 4), '#111', [0.07, 0.66, 0.1]), P(new THREE.SphereGeometry(0.03, 5, 4), '#111', [-0.07, 0.66, 0.1]));
    g.add(new THREE.Mesh(M(...parts), MAT.vc));
    const fin = new THREE.Mesh(P(vFin([[0, 0.1], [-0.18, 0.2], [-0.2, -0.05]]), '#ffd07a'), MAT.vcD); fin.position.set(0, 0.2, -0.1); g.add(fin);
    return { root: g, anim(t) { fin.rotation.y = Math.sin(t * 20) * 0.4; } };
  },
  dumbo() {
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0xf0a8b0, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x3a1018, emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), mat); body.scale.set(1, 1.05, 0.95); body.position.y = 0.25; g.add(body);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 12, 1, true), mat); skirt.position.y = -0.2; skirt.rotation.x = Math.PI; g.add(skirt);
    const ears = [];
    for (const sx of [1, -1]) { const p = new THREE.Group(); p.position.set(sx * 0.35, 0.45, 0); const m = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), mat); m.scale.set(1, 0.6, 1); m.position.x = sx * 0.25; m.rotation.x = -Math.PI / 2; p.add(m); g.add(p); ears.push([p, sx]); }
    g.add(new THREE.Mesh(M(P(new THREE.SphereGeometry(0.05, 6, 4), '#2a0d14', [0.15, 0.3, 0.4]), P(new THREE.SphereGeometry(0.05, 6, 4), '#2a0d14', [-0.15, 0.3, 0.4])), MAT.vc));
    return { root: g, anim(t) { for (const [p, sx] of ears) p.rotation.z = sx * Math.sin(t * 3) * 0.6; } };
  },
};
export const NET_GEO = () => displace(new THREE.IcosahedronGeometry(1, 1), 0.12, 2, 9);
