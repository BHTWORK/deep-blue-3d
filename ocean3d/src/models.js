// Procedural low-poly models built from primitives (merged, vertex-colored).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, NZ, mulberry32 } from './util.js';
import { addCaustics, addGrime } from './world.js';

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
export const ENVMATS = []; // materials that mirror their surroundings; main.js gives them the environment map
const envMat = (m, k) => { m.userData.env = k; ENVMATS.push(m); return m; };
export function initMaterials() {
  // skin, shell, paint: sunlight ripples over whatever faces up, the surface is faintly mottled, and wet things catch a little of the light around them
  const live = (m) => envMat(addGrime(addCaustics(m, 0.45), { silt: 0, algae: 0, wear: 0.14, scale: 1.6 }), 0.35);
  MAT.vc = live(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
  MAT.vcD = live(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
  MAT.metal = envMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 }), 0.8);
  MAT.glass = envMat(new THREE.MeshStandardMaterial({ color: 0xa8dcee, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.3, emissive: 0x0a3a50, emissiveIntensity: 0.2 }), 1.6);
  MAT.bag = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  MAT.net = new THREE.MeshBasicMaterial({ color: 0x7fd0c0, wireframe: true, transparent: true, opacity: 0.85 });
  MAT.bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.9 });
  MAT.glowCyan = new THREE.MeshBasicMaterial({ color: 0xa8fbff, fog: false });
  MAT.glowCyan.color.multiplyScalar(2.2);
  trashMaterials();
}

// ---------------------------------------------------------------- submarine
// a rod of radius r from a to b, for rails, struts and masts
function rod(a, b, r, color, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), e = new THREE.Euler().setFromQuaternion(q);
  return P(new THREE.CylinderGeometry(r, r, d.length(), seg), color, A.add(B).multiplyScalar(0.5).toArray(), [e.x, e.y, e.z]);
}
// a flat shape with thickness, standing in the y-z plane (vertical) or lying in the x-z plane (horizontal)
const slab = (pts, d) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), { depth: d, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -d / 2);
// a five-blade propeller of radius r, each blade twisted along its own length, spinning about z
const propGeo = (r, n = 5, w = 0.16) => M(...Array.from({ length: n }, (_, i) => P(new THREE.BoxGeometry(w, r * 0.82, 0.035).translate(0, r * 0.59, 0).rotateY(0.5).rotateZ((i * TAU) / n), '#c9d2d8')),
  P(new THREE.ConeGeometry(r * 0.3, r * 0.6, 12), '#c9d2d8', [0, 0, -r * 0.32], [-Math.PI / 2, 0, 0]),
  P(new THREE.CylinderGeometry(r * 0.22, r * 0.26, r * 0.4, 12), '#8a96a2', [0, 0, r * 0.2], [Math.PI / 2, 0, 0]));
// A crewed research submersible of the kind that works wrecks and reefs: the pilot sits in a clear acrylic sphere
// at the bow; behind it a block of buoyancy foam (yellow topsides, white below) rides on a tubular frame that
// carries battery pods, thrusters in nozzles, lights and a sample basket. +z is the bow.
export function buildSub() {
  const Y = '#f2c318', W = '#e4e7e8', D = '#1e2329', G = '#8d979f', K = '#2b3137', O = '#e2571c', N = '#1f3550';
  // the foam fairing in side view (z, y), extruded across the beam with rounded edges: a yellow upper block and a white lower one,
  // with the dark gap of the joint between them as the waistline (the rounded edges add 0.11 all round)
  const ext = (sh) => new THREE.ExtrudeGeometry(sh, { depth: 1.26, bevelEnabled: true, bevelSize: 0.11, bevelThickness: 0.11, bevelSegments: 4, curveSegments: 10 }).translate(0, 0, -0.63).rotateY(-Math.PI / 2);
  const up = new THREE.Shape(); up.moveTo(-1.9, 0.33); up.lineTo(-1.82, 0.5); up.quadraticCurveTo(-1.62, 0.86, -1.1, 0.9); up.lineTo(0.05, 0.94); up.quadraticCurveTo(0.5, 0.94, 0.58, 0.62); up.lineTo(0.51, 0.33); up.closePath();
  const lo = new THREE.Shape(); lo.moveTo(-1.93, 0.03); lo.lineTo(0.45, 0.03); lo.lineTo(0.3, -0.42); lo.lineTo(-1.55, -0.46); lo.quadraticCurveTo(-1.9, -0.4, -1.93, 0.03);
  const fairing = [P(ext(up), Y), P(ext(lo), W), P(new THREE.BoxGeometry(1.4, 0.3, 2.4), D, [0, 0.18, -0.72])];
  // stern planes and a fin: (z, r) outline with the root on the fairing
  const FIN = [[-1.45, 0.0], [-2.05, 0.42], [-2.3, 0.42], [-2.25, 0.0]];
  const fins = [P(slab(FIN.map(([z, r]) => [z, 0.82 + r]), 0.05).rotateY(-Math.PI / 2), Y, [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => (y > 1.12 ? [0.89, 0.34, 0.11] : [0.95, 0.76, 0.09])),
    ...[1, -1].map((sg) => P(slab(FIN.map(([z, r]) => [sg * (0.7 + r * 1.1), z]), 0.05).rotateX(Math.PI / 2), W, [0, 0.2, 0]))];
  // battery pods low on each side, strapped to the frame
  const pods = [1, -1].flatMap((sx) => [P(new THREE.CapsuleGeometry(0.2, 1.25, 5, 16), K, [sx * 0.66, -0.66, -0.6], [Math.PI / 2, 0, 0]),
    ...[-1.05, -0.15].map((z) => P(new THREE.TorusGeometry(0.205, 0.022, 5, 18), G, [sx * 0.66, -0.66, z])),
    rod([sx * 0.5, -0.46, -1.05], [sx * 0.62, -0.5, -1.05], 0.03, G), rod([sx * 0.5, -0.46, -0.15], [sx * 0.62, -0.5, -0.15], 0.03, G)]);
  // manoeuvring thrusters on outriggers, each in a ring nozzle
  const side2 = [1, -1].flatMap((sx) => [P(new THREE.BoxGeometry(0.34, 0.06, 0.1), G, [sx * 0.9, -0.15, -1.16]), P(new THREE.CapsuleGeometry(0.06, 0.1, 3, 10), K, [sx * 1.08, -0.15, -1.1], [Math.PI / 2, 0, 0]),
    P(lathe([[0.16, -0.09], [0.185, -0.07], [0.195, 0.02], [0.185, 0.09], [0.165, 0.1], [0.16, 0.06], [0.16, -0.09]], 20), K, [sx * 1.08, -0.15, -1.16]),
    ...[0, 1, 2].map((i) => rod([sx * 1.08, -0.15, -1.12], [sx * 1.08 + Math.cos(i * 2.1) * 0.17, -0.15 + Math.sin(i * 2.1) * 0.17, -1.12], 0.012, G, 4))]);
  // skids: a rail each side with an upturned toe, on struts up to the frame
  const skids = [1, -1].flatMap((sx) => [rod([sx * 0.66, -1.0, -1.3], [sx * 0.66, -1.0, 0.95], 0.045, G), rod([sx * 0.66, -1.0, 0.95], [sx * 0.66, -0.84, 1.22], 0.045, G),
    ...[-1.05, -0.15, 0.6].map((z) => rod([sx * 0.66, -1.0, z], [sx * 0.6, -0.5, z], 0.032, G)), rod([sx * 0.6, -0.5, -1.4], [sx * 0.6, -0.5, 0.75], 0.032, G), rod([sx * 0.6, -0.5, 0.75], [sx * 0.62, -0.52, 1.2], 0.03, G)]);
  // cross members, the bar the lamps hang on and the handrails round the hatch
  const frame = [...[-1.05, -0.15, 0.6].map((z) => rod([-0.66, -1.0, z], [0.66, -1.0, z], 0.03, G)), rod([-0.72, -0.52, 1.22], [0.72, -0.52, 1.22], 0.035, G),
    ...[1, -1].flatMap((sx) => [rod([sx * 0.36, 1.12, -0.5], [sx * 0.36, 1.12, 0.3], 0.016, G, 5), ...[-0.5, -0.1, 0.3].map((z) => rod([sx * 0.36, 0.95, z], [sx * 0.36, 1.12, z], 0.014, G, 5))])];
  // (the manipulator arm on the starboard bow is a separate, moving model: see ROBOT ARM in main.js)
  // sample basket on the port bow: a tray of bars
  const basket = [rod([-0.7, -0.92, 1.0], [-0.7, -0.92, 1.5], 0.016, G, 5), rod([-0.2, -0.92, 1.0], [-0.2, -0.92, 1.5], 0.016, G, 5), ...[1.0, 1.25, 1.5].map((z) => rod([-0.7, -0.92, z], [-0.2, -0.92, z], 0.016, G, 5)),
    ...[-0.7, -0.2].flatMap((x) => [rod([x, -0.92, 1.5], [x, -0.76, 1.5], 0.014, G, 5), rod([x, -0.92, 1.0], [x, -0.76, 1.0], 0.014, G, 5)]), rod([-0.7, -0.76, 1.5], [-0.2, -0.76, 1.5], 0.014, G, 5), rod([-0.7, -0.76, 1.0], [-0.7, -0.76, 1.5], 0.014, G, 5), rod([-0.2, -0.76, 1.0], [-0.2, -0.76, 1.5], 0.014, G, 5)];
  const body = M(
    ...fairing,
    // the ring that clamps the sphere to the fairing, and the sphere's own penetrator plate
    P(new THREE.TorusGeometry(0.69, 0.055, 8, 36), G, [0, 0.12, 0.72]), P(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), G, [0, 0.83, 1.12]),
    // inside the sphere: floor, seat, console and the pilot
    P(new THREE.CylinderGeometry(0.58, 0.58, 0.04, 20), D, [0, -0.3, 1.12]), P(new THREE.BoxGeometry(0.4, 0.5, 0.1), '#39424c', [0, 0.02, 0.82], [-0.12, 0, 0]), P(new THREE.BoxGeometry(0.4, 0.09, 0.36), '#39424c', [0, -0.22, 1.0]),
    P(new THREE.BoxGeometry(0.62, 0.1, 0.16), D, [0, -0.16, 1.5], [0.5, 0, 0]),
    P(new THREE.CapsuleGeometry(0.13, 0.2, 4, 10), '#24456e', [0, 0.02, 0.98]), P(new THREE.SphereGeometry(0.1, 12, 10), '#e7bd9a', [0, 0.32, 1.0]), P(new THREE.SphereGeometry(0.106, 12, 6, 0, TAU, 0, Math.PI / 2), N, [0, 0.345, 1.0]),
    ...[1, -1].map((sx) => rod([sx * 0.13, 0.06, 1.0], [sx * 0.2, -0.1, 1.38], 0.035, '#24456e', 6)),
    // hatch trunk with its wheel, the mast for the beacon and a whip antenna
    P(new THREE.CylinderGeometry(0.27, 0.3, 0.22, 20), W, [0, 1.04, -0.1], [0, 0, 0], [1, 1, 1], (x, y) => (y > 1.08 && y < 1.13 ? [0.89, 0.34, 0.11] : [0.9, 0.91, 0.91])),
    P(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 20), G, [0, 1.17, -0.1]), P(new THREE.TorusGeometry(0.11, 0.018, 6, 16), K, [0, 1.21, -0.1], [Math.PI / 2, 0, 0]),
    rod([0, 0.92, -0.75], [0, 1.76, -0.3], 0.026, G), rod([0, 0.92, -0.3], [0, 1.4, -0.3], 0.02, G), rod([0.08, 0.92, -0.9], [0.1, 1.95, -1.0], 0.008, D, 4),
    // lamp housings on the bow bar, the light bar over the sphere, and the beam projector slung below it
    ...[1, -1].map((sx) => P(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 14), D, [sx * 0.45, -0.52, 1.31], [Math.PI / 2, 0, 0])),
    rod([-0.6, 0.98, 0.7], [0.6, 0.98, 0.7], 0.03, G), ...[-0.5, -0.18, 0.18, 0.5].map((x) => P(new THREE.CylinderGeometry(0.07, 0.085, 0.16, 12), D, [x, 0.98, 0.78], [Math.PI / 2, 0, 0])),
    P(new THREE.CylinderGeometry(0.09, 0.12, 0.34, 14), D, [0, -0.6, 1.55], [Math.PI / 2, 0, 0]), P(new THREE.TorusGeometry(0.095, 0.022, 6, 16), G, [0, -0.6, 1.72]), rod([0, -0.52, 1.22], [0, -0.58, 1.4], 0.03, G),
    // main thruster: motor on a stalk, in a nozzle held by four struts
    P(new THREE.CylinderGeometry(0.11, 0.13, 0.36, 14), K, [0, 0.1, -2.02], [Math.PI / 2, 0, 0]),
    P(lathe([[0.4, -2.42], [0.45, -2.36], [0.47, -2.2], [0.46, -2.05], [0.42, -1.98], [0.4, -2.0], [0.4, -2.42]], 28), K, [0, 0.1, 0]),
    ...[0, 1, 2, 3].map((i) => rod([Math.cos(i * 1.571 + 0.785) * 0.12, 0.1 + Math.sin(i * 1.571 + 0.785) * 0.12, -2.05], [Math.cos(i * 1.571 + 0.785) * 0.43, 0.1 + Math.sin(i * 1.571 + 0.785) * 0.43, -2.12], 0.016, G, 5)),
    ...fins, ...pods, ...side2, ...skids, ...frame, ...basket,
  );
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body, envMat(addGrime(addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.22, emissive: 0x2a1a00, emissiveIntensity: 0.18 }), 0.5), { silt: 0.1, algae: 0.08, wear: 0.1, scale: 0.6 }), 0.9)); g.add(bodyMesh);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 20), MAT.glass); dome.position.set(0, 0.12, 1.12); g.add(dome);
  // lit instruments inside the sphere
  const ports = new THREE.Mesh(M(P(new THREE.PlaneGeometry(0.24, 0.1), '#7fe0ff', [-0.15, -0.1, 1.47], [-Math.PI / 2 + 0.5, 0, 0]), P(new THREE.PlaneGeometry(0.24, 0.1), '#9dffc8', [0.15, -0.1, 1.47], [-Math.PI / 2 + 0.5, 0, 0])), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  g.add(ports);
  const lamps = new THREE.Mesh(M(P(new THREE.CircleGeometry(0.115, 14), '#fff', [0.45, -0.52, 1.465]), P(new THREE.CircleGeometry(0.115, 14), '#fff', [-0.45, -0.52, 1.465]), ...[-0.5, -0.18, 0.18, 0.5].map((x) => P(new THREE.CircleGeometry(0.062, 12), '#fff', [x, 0.98, 0.862]))), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  lamps.material.color.setScalar(3); g.add(lamps);
  // beam projector lens and the beacon on the mast; main.js drives their glow
  const emitter = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), new THREE.MeshBasicMaterial({ color: 0x7fe9ff, fog: false })); emitter.position.set(0, -0.6, 1.725); g.add(emitter);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2e, fog: false })); beacon.position.set(0, 1.8, -0.3); g.add(beacon);
  // hull number on both sides of the fairing
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 80; const cx = cv.getContext('2d');
  cx.fillStyle = N; cx.font = '700 62px "Helvetica Neue", Arial, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('DB-01', 128, 44);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const decal = new THREE.Mesh(mergeGeometries([1, -1].map((sx) => new THREE.PlaneGeometry(0.72, 0.225).rotateY(sx * Math.PI / 2).translate(sx * 0.744, 0.56, -0.85))),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
  g.add(decal);
  const prop = new THREE.Mesh(propGeo(0.36), MAT.metal); prop.position.set(0, 0.1, -2.2); g.add(prop);
  const thr = [1, -1].map((sx) => { const m = new THREE.Mesh(propGeo(0.13, 3, 0.06), MAT.metal); m.position.set(sx * 1.08, -0.15, -1.16); g.add(m); return m; });
  return { root: g, prop, thr, lamps, emitter, beacon, bodyMesh };
}

// ---------------------------------------------------------------- trash
// Litter is modelled on the real objects. Printed surfaces (labels, the can's body, the cup's sleeve) take their
// design from one small sheet drawn here; every brand on it is made up.
function labelSheet() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 256); x.textAlign = 'center'; x.textBaseline = 'middle';
  // bottled water label (0..256, 0..128)
  let g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#1d7fd0'); g.addColorStop(1, '#0f4f9a'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#eaf6ff'; x.beginPath(); x.moveTo(0, 96); for (let i = 0; i <= 256; i += 8) x.lineTo(i, 96 + Math.sin(i * 0.07) * 9); x.lineTo(256, 128); x.lineTo(0, 128); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 44px sans-serif'; x.fillText('맑은샘', 82, 44); x.font = '15px sans-serif'; x.fillText('먹는샘물 500mL', 82, 78);
  x.fillStyle = '#fff'; x.fillRect(176, 22, 62, 56); x.fillStyle = '#111'; for (let i = 0; i < 26; i++) if ((i * 7) % 5 < 3) x.fillRect(180 + i * 2.1, 26, 1.4, 40); x.font = '8px sans-serif'; x.fillText('8 801234 567890', 207, 72);
  // soda can body (256..512, 0..128): bare aluminium at the two ends
  x.fillStyle = '#c3c8cc'; x.fillRect(256, 0, 256, 128); g = x.createLinearGradient(0, 10, 0, 118); g.addColorStop(0, '#f59a1b'); g.addColorStop(1, '#e2620f'); x.fillStyle = g; x.fillRect(256, 10, 256, 108);
  x.strokeStyle = '#fff3d6'; x.lineWidth = 9; x.beginPath(); x.moveTo(256, 104); x.bezierCurveTo(330, 60, 420, 120, 512, 70); x.stroke();
  x.fillStyle = '#fff'; x.font = 'italic bold 46px sans-serif'; x.fillText('FIZZ', 330, 52); x.font = 'bold 12px sans-serif'; x.fillText('ORANGE SODA', 330, 84);
  x.fillStyle = '#fff3d6'; x.beginPath(); x.arc(452, 58, 26, 0, TAU); x.fill(); x.fillStyle = '#e2620f'; x.beginPath(); x.arc(452, 58, 19, 0, TAU); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 13px sans-serif'; x.fillText('355', 452, 58);
  // paper cup with its sleeve (0..200, 128..256)
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 128, 200, 128); x.fillStyle = '#8a5a34'; x.fillRect(0, 166, 200, 58); x.fillStyle = '#6f4526'; for (let i = 0; i < 200; i += 6) x.fillRect(i, 166, 1.5, 58);
  x.fillStyle = '#f4f1ea'; x.beginPath(); x.arc(100, 195, 21, 0, TAU); x.fill(); x.fillStyle = '#6f4526'; x.font = 'bold 12px sans-serif'; x.fillText('CAFÉ', 100, 196);
  // aged paper label of a glass bottle (200..360, 128..256)
  x.fillStyle = '#e4d6ae'; x.fillRect(200, 128, 160, 128); x.strokeStyle = '#7a5b2a'; x.lineWidth = 3; x.strokeRect(210, 138, 140, 108);
  x.fillStyle = '#5c4320'; x.font = 'bold 30px serif'; x.fillText('1987', 280, 178); x.font = '12px serif'; x.fillText('ORIGINAL', 280, 208); x.fillText('· 330 mL ·', 280, 226);
  for (let i = 0; i < 420; i++) { x.fillStyle = `rgba(90,70,40,${Math.random() * 0.12})`; x.fillRect(200 + Math.random() * 160, 128 + Math.random() * 128, 3 + Math.random() * 10, 2 + Math.random() * 5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// a net's mesh: knotted diamonds on a transparent ground
function netSheet() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.clearRect(0, 0, 128, 128); x.strokeStyle = '#fff'; x.lineWidth = 5; x.lineCap = 'round';
  for (let i = -4; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + 128, 128); x.stroke(); x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 - 128, 128); x.stroke(); }
  x.fillStyle = '#fff'; for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) { x.beginPath(); x.arc(i * 32 + (j % 2 ? 16 : 0), j * 16 * 2 - (j % 2 ? 0 : 0) + (j % 2 ? 0 : 0), 0, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
// like P, but keeps the texture coordinates
function PT(geo, color, pos, rot, scl, colorFn) { const g0 = geo.index ? geo.toNonIndexed() : geo, uv = g0.attributes.uv.clone(), g = P(g0, color, pos, rot, scl, colorFn); g.setAttribute('uv', uv); return g; }
// moves a part's texture coordinates into a rectangle of the label sheet (v runs upward); BLANK is a white corner of it
const uvTo = (g, u0, v0, u1, v1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); return g; };
const blank = (g) => uvTo(g, 0.8, 0.1, 0.9, 0.3);
// a body of revolution about y from [radius, height] pairs, optionally bent out of true by warp(v) before its normals are made
const turn = (prof, seg = 18, warp) => { const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), seg); if (warp) bend(g, warp); return g; };
function bend(g, warp) { const p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); warp(v); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; }
// several material groups in one geometry: parts = [[geometry, material], ...]
function grouped(parts) { const g = mergeGeometries(parts.map((p) => p[0]), true); g.computeBoundingSphere(); g.userData.mat = parts.map((p) => p[1]); return g; }
const TM = {};
function trashMaterials() {
  const sheet = labelSheet(), std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o }), env = (m, k) => { m.userData.env = k; ENVMATS.push(m); return m; };
  TM.junk = env(addGrime(addCaustics(std({ roughness: 0.7, metalness: 0.05 }), 0.35)), 0.25);
  TM.junkD = env(addGrime(addCaustics(std({ roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }), 0.35)), 0.25);
  TM.rust = env(addGrime(addCaustics(std({ roughness: 0.8, metalness: 0.3 }), 0.35), { silt: 0.6, algae: 0.5, wear: 0.4 }), 0.3);
  TM.print = env(addGrime(addCaustics(std({ map: sheet, roughness: 0.5 }), 0.35), { silt: 0.45, algae: 0.3 }), 0.4);
  TM.alu = env(addGrime(addCaustics(std({ map: sheet, roughness: 0.34, metalness: 0.85 }), 0.35), { silt: 0.45, algae: 0.3, wear: 0.15 }), 1);
  TM.pet = env(addGrime(addCaustics(std({ roughness: 0.06, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }), 0.2), { silt: 0.5, algae: 0.4, wear: 0.1 }), 1.3);
  TM.glassT = env(addGrime(addCaustics(std({ roughness: 0.05, transparent: true, opacity: 0.8, side: THREE.DoubleSide }), 0.2), { silt: 0.5, algae: 0.45, wear: 0.1 }), 1.2);
  TM.film = env(addGrime(addCaustics(std({ roughness: 0.22, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }), 0.3), { silt: 0.25, algae: 0.25, wear: 0.1, bump: 0.035, bumpFreq: 9 }), 1.1);
  TM.foam = addGrime(addCaustics(std({ roughness: 0.95 }), 0.4), { silt: 0.4, algae: 0.4, wear: 0.12, bump: 0.02, bumpFreq: 34 });
  TM.rubber = addGrime(addCaustics(std({ roughness: 0.92 }), 0.3), { silt: 0.65, algae: 0.45, wear: 0.3 });
  TM.rope = addGrime(addCaustics(std({ roughness: 0.95 }), 0.35), { silt: 0.4, algae: 0.5, wear: 0.4, bump: 0.02, bumpFreq: 60 });
  TM.net = addCaustics(new THREE.MeshStandardMaterial({ map: netSheet(), color: '#69b39f', alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 }), 0.3);
}
const shadeY = (y0, y1, a, b) => (x, y) => { const v = a + (b - a) * THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1); return [v, v, v]; };
function petBottle() {
  // crushed a little: flattened where a hand squeezed it
  const sq = (v) => { const k = Math.exp(-(((v.y - 0.02) / 0.16) ** 2)) * 0.2; v.x *= 1 - k * 0.9; v.z *= 1 + k * 0.25; v.x += Math.sin(v.y * 9) * 0.006; };
  const body = turn([[0, -0.29], [0.05, -0.3], [0.1, -0.312], [0.15, -0.3], [0.168, -0.27], [0.17, -0.22], [0.161, -0.2], [0.17, -0.18], [0.17, -0.14], [0.161, -0.12], [0.17, -0.1], [0.168, -0.06], [0.168, 0.2], [0.17, 0.22], [0.161, 0.24], [0.17, 0.26], [0.166, 0.31], [0.146, 0.37], [0.11, 0.43], [0.076, 0.49], [0.062, 0.525], [0.062, 0.55], [0.076, 0.556], [0.076, 0.568], [0.062, 0.574], [0.062, 0.6]], 14, sq);
  const label = bend(new THREE.CylinderGeometry(0.1705, 0.1705, 0.25, 14, 2, true).translate(0, 0.07, 0), sq);
  const cap = new THREE.CylinderGeometry(0.073, 0.073, 0.055, 16).translate(0, 0.61, 0);
  return grouped([[blank(PT(body, '#a9cfe0')), TM.pet], [M(uvTo(PT(label, '#fff'), 0, 0.5, 0.5, 1), blank(PT(cap, '#1f6fd0', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => (Math.sin(Math.atan2(z, x) * 30) > 0.2 ? [0.1, 0.38, 0.78] : [0.13, 0.46, 0.86])))), TM.print]]);
}
function glassBottle() {
  const body = turn([[0, -0.29], [0.1, -0.3], [0.14, -0.31], [0.152, -0.29], [0.152, 0.1], [0.146, 0.17], [0.118, 0.26], [0.08, 0.34], [0.058, 0.41], [0.052, 0.55], [0.064, 0.558], [0.064, 0.59], [0.05, 0.6], [0.04, 0.6]], 14);
  const label = new THREE.CylinderGeometry(0.1535, 0.1535, 0.2, 10, 1, true, 0.4, 3.6).translate(0, -0.08, 0);
  return grouped([[blank(PT(body, '#3f8a4c', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => { const k = 0.8 + 0.3 * THREE.MathUtils.clamp((y + 0.3) / 0.9, 0, 1); return [0.2 * k, 0.5 * k, 0.26 * k]; })), TM.glassT], [uvTo(PT(label, '#fff'), 0.39, 0, 0.7, 0.5), TM.print]]);
}
function sodaCan() {
  // stepped on: creased across the middle and bent
  const cr = (v) => { const k = Math.exp(-((v.y / 0.07) ** 2)), a = Math.atan2(v.z, v.x); const s = 1 - k * (0.2 + 0.2 * Math.cos(a * 2 + 0.6)); v.x *= s; v.z *= s; v.x += v.y * v.y * 0.5; };
  const side = bend(new THREE.CylinderGeometry(0.14, 0.14, 0.36, 16, 6, true), cr);
  const ends = [turn([[0, -0.17], [0.085, -0.172], [0.1, -0.2], [0.112, -0.205], [0.124, -0.198], [0.14, -0.18]], 16, cr), turn([[0.14, 0.18], [0.128, 0.208], [0.12, 0.218], [0.113, 0.21], [0.108, 0.196], [0, 0.196]], 16, cr)];
  const tab = new THREE.BoxGeometry(0.05, 0.004, 0.09).translate(0.03, 0.2, 0);
  const g = M(uvTo(PT(side, '#fff'), 0.5, 0.5, 1, 1), ...ends.map((e) => blank(PT(e, '#c9cdd1'))), blank(PT(tab, '#b8bdc2'))); g.rotateZ(Math.PI / 2); g.userData.mat = TM.alu; return g;
}
function plasticBag() {
  // a billowed carrier bag: gathered toward the handles, crumpled all over
  const g = new THREE.SphereGeometry(0.5, 18, 13, 0, TAU, 0.25, Math.PI - 0.25), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const t = (v.y + 0.5), top = THREE.MathUtils.smoothstep(v.y, 0.1, 0.5), n = NZ(v.x * 4.2 + 3, v.y * 4.2 + v.z * 3.1), n2 = NZ(v.x * 9 + v.z * 7, v.y * 9 - 4);
    const r = 1 - top * 0.55 + n * 0.16 + n2 * 0.06; v.x *= r * 0.9; v.z *= r * 0.62; v.y = v.y * 1.25 + n2 * 0.04 + t * 0.02; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const handle = (sx) => bend(new THREE.TorusGeometry(0.13, 0.016, 5, 14, Math.PI * 1.1).translate(0, 0, 0), (q) => { q.z *= 0.4; }).rotateZ(-0.15 * sx).translate(sx * 0.1, 0.62, 0);
  const col = (x, y) => { const k = 0.9 + 0.1 * NZ(x * 6, y * 6); return [k, k, k]; };
  const out = M(P(g, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], col), P(handle(1), '#f4f4f4'), P(handle(-1), '#f4f4f4')); out.userData.mat = TM.film; return out;
}
function paperCup() {
  const side = new THREE.CylinderGeometry(0.15, 0.105, 0.36, 20, 1, true), base = new THREE.CircleGeometry(0.105, 20).rotateX(Math.PI / 2).translate(0, -0.17, 0);
  const lid = turn([[0.156, 0.165], [0.162, 0.175], [0.16, 0.195], [0.148, 0.205], [0.14, 0.222], [0.06, 0.226], [0, 0.226]], 20);
  const straw = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6).translate(0, 0.21, 0).rotateZ(-0.22).translate(0.05, 0.2, 0.02);
  const g = M(uvTo(PT(side, '#fff'), 0, 0, 0.39, 0.5), blank(PT(base, '#e8e3d8')), blank(PT(lid, '#f2f2f0')), blank(PT(straw, '#2f9a4a', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y) => (Math.sin(y * 60) > 0 ? [0.2, 0.62, 0.3] : [0.92, 0.92, 0.9])))); g.userData.mat = TM.print; return g;
}
function faceMask() {
  // a pleated surgical mask with its ear loops, curved as it was worn
  const g = new THREE.PlaneGeometry(0.56, 0.34, 10, 10).rotateX(-Math.PI / 2);
  bend(g, (v) => { const u = v.x / 0.28, w = v.z / 0.17; v.y = 0.05 * (1 - u * u) + 0.012 * Math.sin(w * 9.5) * (1 - u * u * 0.6) + 0.03 * (1 - w * w); });
  const loop = (sx) => bend(new THREE.TorusGeometry(0.15, 0.007, 3, 10, Math.PI * 1.25), (q) => { q.z += q.x * q.x * 0.6; }).rotateX(Math.PI / 2).rotateY(sx > 0 ? -0.6 : Math.PI + 0.6).translate(sx * 0.33, 0.0, 0);
  const out = M(P(g, '#9fd0e6', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const k = 0.9 + 0.1 * Math.sin(z / 0.17 * 9.5 + 1.2), e = Math.abs(z) > 0.155 || Math.abs(x) > 0.265 ? 1.12 : 1; return [0.3 * k * e, 0.56 * k * e, 0.78 * k * e]; }), P(loop(1), '#f4f6f7'), P(loop(-1), '#f4f6f7'));
  out.userData.mat = TM.junkD; return out;
}
function foamChunk() {
  // a broken block of expanded polystyrene: one corner snapped off, edges crumbled
  const g = new THREE.BoxGeometry(0.7, 0.4, 0.5, 7, 4, 5);
  bend(g, (v) => { const n = NZ(v.x * 5 + 1, v.y * 5 + v.z * 4), c = Math.max(0, v.x * 1.1 + v.y * 0.9 + v.z * 0.8 - 0.42); v.x -= c * 0.9; v.y -= c * 0.75; v.z -= c * 0.6; const l = v.length() || 1; v.multiplyScalar(1 + n * 0.035 / l); });
  const out = P(g, '#f3f1ea', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const k = 0.9 + 0.1 * NZ(x * 9, y * 9 + z * 7); return [0.95 * k, 0.94 * k, 0.9 * k]; }); out.userData.mat = TM.foam; return out;
}
function ropeTangle() {
  // a length of polypropylene rope dropped in a loose heap
  const r = mulberry32(77), pts = []; for (let i = 0; i < 26; i++) { const a = i * 0.95 + r() * 0.5, d = 0.2 + 0.24 * r() + 0.1 * Math.sin(i * 0.7); pts.push(new THREE.Vector3(Math.cos(a) * d, 0.04 + 0.2 * r() * (i % 3 ? 0.5 : 1), Math.sin(a) * d * 0.85)); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6), 80, 0.034, 5, false);
  const out = P(g, '#e0862e', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const k = 0.75 + 0.3 * (NZ(x * 20, z * 20 + y * 14) * 0.5 + 0.5); return [0.84 * k, 0.5 * k, 0.17 * k]; }); out.userData.mat = TM.rope; return out;
}
function tyre() {
  // section through the tyre: bead, sidewall, shoulder, flat tread (corners doubled to keep them crisp), with two rows of raised tread blocks
  const sec = [[0.5, -0.1], [0.47, -0.13], [0.45, -0.2], [0.5, -0.25], [0.68, -0.285], [0.88, -0.28], [0.955, -0.262], [0.96, -0.26], [0.995, -0.225], [1, -0.22], [1, 0.22], [0.995, 0.225], [0.96, 0.26], [0.955, 0.262], [0.88, 0.28], [0.68, 0.285], [0.5, 0.25], [0.45, 0.2], [0.47, 0.13], [0.5, 0.1], [0.5, -0.1]];
  const parts = [P(turn(sec, 30).rotateX(Math.PI / 2), '#141416', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const rr = Math.hypot(x, y), a = Math.atan2(y, x), t = rr > 0.62 && rr < 0.8 && Math.sin(a * 5) > 0.3 && Math.abs(Math.sin(a * 60)) > 0.6 ? 0.15 : 0.085; return [t, t, t * 1.05]; })];
  for (let i = 0; i < 30; i++) for (const sd of [-1, 1]) { const a = ((i + (sd > 0 ? 0.5 : 0)) / 30) * TAU;
    parts.push(P(new THREE.BoxGeometry(0.035, 0.13, 0.2), '#101012', [Math.cos(a) * 1.0, Math.sin(a) * 1.0, sd * 0.125], [0, 0, a + sd * 0.25])); }
  const out = M(...parts); out.userData.mat = TM.rubber; return out;
}
function oilDrum(colorFn) {
  const ring = (y) => [[0.62, y - 0.05], [0.655, y - 0.02], [0.655, y + 0.02], [0.62, y + 0.05]];
  const prof = [[0, -0.86], [0.6, -0.86], [0.64, -0.875], [0.645, -0.84], [0.62, -0.82], ...ring(-0.3), ...ring(0.3), [0.62, 0.82], [0.645, 0.84], [0.64, 0.875], [0.6, 0.86], [0.6, 0.83], [0, 0.83]];
  // dented in one side
  const g = turn(prof, 20, (v) => { const k = Math.exp(-(((v.y - 0.1) / 0.3) ** 2)) * Math.max(0, v.x / 0.62) ** 3; v.x -= k * 0.16; });
  const bung = (x, z, r) => P(new THREE.CylinderGeometry(r, r, 0.04, 10), '#6d6a5a', [x, 0.85, z]);
  const out = M(P(g, '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], colorFn), bung(0.36, 0, 0.07), bung(-0.3, 0.2, 0.04)); out.userData.mat = TM.rust; return out;
}
function ghostNet() {
  // a lost fishing net heaped on itself, with a few floats still tied on
  const g = new THREE.SphereGeometry(1.5, 24, 14), p = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = NZ(v.x * 1.3 + 2, v.y * 1.3 + v.z * 1.1) * 0.42 + NZ(v.x * 3.1, v.z * 3.1 + v.y * 2.6) * 0.16; v.multiplyScalar(1 + n); v.y = v.y * 0.62 - 0.1; p.setXYZ(i, v.x, v.y, v.z); uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 20); }
  g.computeVertexNormals(); g.computeBoundingSphere(); g.userData.mat = TM.net; return g;
}
export function buildTrashGeos() {
  const G = {};
  G.bottle = petBottle(); G.glass = glassBottle(); G.can = sodaCan(); G.bag = plasticBag(); G.mask = faceMask(); G.styro = foamChunk(); G.cup = paperCup(); G.rope = ropeTangle(); G.tire = tyre();
  const bars = [];
  for (let i = -3; i <= 3; i++) bars.push(P(new THREE.BoxGeometry(0.03, 0.03, 1.5), '#a9b1b8', [i * 0.18, 0.2, 0]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [i * 0.18, 0.5, 0.75]));
  for (let j = -3; j <= 3; j++) bars.push(P(new THREE.BoxGeometry(1.1, 0.03, 0.03), '#a9b1b8', [0, 0.2, j * 0.22]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [0.55, 0.5, j * 0.22]), P(new THREE.BoxGeometry(0.03, 0.6, 0.03), '#a9b1b8', [-0.55, 0.5, j * 0.22]));
  bars.push(P(new THREE.BoxGeometry(1.1, 0.05, 0.05), '#d33c2f', [0, 0.95, -0.85]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [0.45, -0.25, 0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [-0.45, -0.25, 0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [0.45, -0.25, -0.6], [0, 0, Math.PI / 2]), P(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), '#151515', [-0.45, -0.25, -0.6], [0, 0, Math.PI / 2]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [0.45, 0, 0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [-0.45, 0, 0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [0.45, 0, -0.6]), P(new THREE.BoxGeometry(0.04, 0.45, 0.04), '#a9b1b8', [-0.45, 0, -0.6]));
  G.cart = M(...bars).translate(0, -0.3, 0);
  G.ewaste = M(P(new THREE.BoxGeometry(0.36, 0.05, 0.7), '#1c1d21'), P(new THREE.BoxGeometry(0.3, 0.01, 0.6), '#1d4a70', [0, 0.03, 0]), P(new THREE.BoxGeometry(0.45, 0.03, 0.32), '#1f7a3a', [0.35, 0, 0.2], [0, 0.4, 0]), P(new THREE.BoxGeometry(0.1, 0.04, 0.1), '#111', [0.35, 0.03, 0.2]));
  G.battery = M(P(new THREE.BoxGeometry(0.85, 0.5, 0.45), '#2b2f36'), P(new THREE.BoxGeometry(0.85, 0.08, 0.46), '#ffc93a', [0, -0.05, 0]), P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), '#d63b2f', [0.28, 0.3, 0]), P(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), '#222', [-0.28, 0.3, 0]));
  G.drum = oilDrum((x, y, z) => { const r = NZ(x * 3, y * 3 + z * 2); if (r > 0.25) return [0.45, 0.22, 0.08]; if (Math.abs(Math.abs(y) - 0.45) < 0.06) return [0.3, 0.24, 0.05]; if (Math.abs(y) < 0.2 && z > 0.3 && Math.abs(x) < 0.3) return [0.05, 0.05, 0.05]; return [0.91, 0.72, 0.16]; });
  G.scrap = M(displace(P(new THREE.BoxGeometry(2.2, 0.16, 1.4, 6, 1, 4), '#8a5230', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const n = NZ(x * 2, z * 2) * 0.5 + 0.5; return [0.35 + 0.25 * n, 0.2 + 0.1 * n, 0.1 + 0.05 * n]; }), 0.15, 1.2, 7), P(new THREE.BoxGeometry(0.2, 0.2, 1.8), '#5b3a26', [0.6, 0.2, 0], [0.3, 0.4, 0]));
  const cont = [P(new THREE.BoxGeometry(7.2, 2.6, 2.6), '#ffffff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => { const rib = Math.sin(x * 9) > 0.6 ? 0.78 : 0.92; const rust = NZ(x * 0.8, y + z) > 0.3 ? 0.6 : 1; return [rib * rust, rib * rust * 0.95, rib * rust * 0.95]; })];
  cont.push(P(new THREE.BoxGeometry(0.06, 2.4, 0.06), '#555555', [3.62, 0, 0.5]), P(new THREE.BoxGeometry(0.06, 2.4, 0.06), '#555555', [3.62, 0, -0.5]));
  G.container = M(...cont);
  G.net = ghostNet();
  // debris from the shipwreck and the crashed airliner
  const moss = (x, y, z, f = 1.4) => NZ(x * f + 9, z * f + y) > 0.45;
  const wood = (x, y, z) => { if (moss(x, y, z)) return [0.22, 0.32, 0.18]; const n = NZ(x * 3 + 1, y * 3 + z * 2) * 0.5 + 0.5, gap = Math.abs((((y + 0.425) / 0.2125) % 1) - 0.5) > 0.42, k = gap ? 0.4 : 0.8 + n * 0.35; return [0.46 * k, 0.31 * k, 0.17 * k]; };
  G.crate = M(P(new THREE.BoxGeometry(1.3, 0.85, 0.9, 6, 8, 4), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], wood),
    ...[-1, 1].flatMap((sd) => [P(new THREE.BoxGeometry(0.12, 0.93, 0.05), '#4a3219', [sd * 0.58, 0, 0.46]), P(new THREE.BoxGeometry(0.12, 0.93, 0.05), '#4a3219', [sd * 0.58, 0, -0.46])]),
    P(new THREE.BoxGeometry(1.36, 0.12, 0.05), '#4a3219', [0, 0, 0.46], [0, 0, 0.62]), P(new THREE.BoxGeometry(1.36, 0.12, 0.05), '#4a3219', [0, 0, -0.46], [0, 0, -0.62]),
    P(new THREE.BoxGeometry(1.25, 0.05, 0.26), '#fff', [0.12, 0.47, 0.26], [0.06, 0.3, 0.05], [1, 1, 1], wood));
  const orange = (x, y, z) => (Math.abs(Math.abs(z) - 0.16) < 0.035 ? [0.82, 0.84, 0.82] : moss(x, y, z, 2.2) ? [0.45, 0.3, 0.1] : [1, 0.36, 0.04]);
  G.vest = M(P(new THREE.BoxGeometry(0.34, 0.15, 0.7, 2, 1, 6), '#fff', [0.19, 0, 0], [0, 0, 0.06], [1, 1, 1], orange), P(new THREE.BoxGeometry(0.34, 0.15, 0.7, 2, 1, 6), '#fff', [-0.19, 0, 0], [0, 0, -0.06], [1, 1, 1], orange),
    P(new THREE.TorusGeometry(0.2, 0.07, 6, 12, Math.PI), '#fff', [0, 0.02, 0.35], [Math.PI / 2, 0, 0], [1, 1, 1], () => [1, 0.36, 0.04]),
    P(new THREE.BoxGeometry(0.78, 0.03, 0.05), '#161616', [0, 0.09, -0.06]), P(new THREE.BoxGeometry(0.09, 0.05, 0.08), '#2a2a2a', [0, 0.1, -0.06]));
  const alu = (x, y, z) => { if (moss(x, y, z, 1.8)) return [0.24, 0.34, 0.2]; if (Math.abs(x + 0.14) < 0.07) return [0.16, 0.26, 0.52]; if (Math.abs(x - 0.13) < 0.1 && Math.abs((((z + 1) / 0.5) % 1) - 0.5) < 0.2) return [0.04, 0.05, 0.07]; const v = 0.45 + (NZ(x * 3, z * 3 + y) * 0.5 + 0.5) * 0.2; return [v * 0.95, v, v * 1.04]; };
  const skin = new THREE.CylinderGeometry(1.4, 1.4, 2, 24, 16, true, -0.55, 1.1).translate(0, 0, -1.4).rotateX(-Math.PI / 2);
  G.panel = M(displace(P(skin, '#fff', [0, 0.12, 0], [0, 0, 0], [1, 1, 1], alu), 0.05, 2.2, 5), P(new THREE.BoxGeometry(0.05, 0.12, 2), '#6a6e74', [0.45, -0.02, 0]), P(new THREE.BoxGeometry(0.05, 0.12, 2), '#6a6e74', [-0.45, -0.02, 0]));
  const fab = (x, y, z) => { if (moss(x, y, z, 2)) return [0.2, 0.3, 0.18]; const n = NZ(x * 4 + 2, y * 4 + z * 3) * 0.5 + 0.5; return [0.1 + 0.05 * n, 0.15 + 0.06 * n, 0.36 + 0.12 * n]; };
  G.seat = M(P(new THREE.BoxGeometry(0.5, 0.14, 0.5, 2, 1, 2), '#fff', [0, 0, 0.02], [0, 0, 0], [1, 1, 1], fab), P(new THREE.BoxGeometry(0.5, 0.75, 0.12, 2, 3, 1), '#fff', [0, 0.36, -0.26], [-0.22, 0, 0], [1, 1, 1], fab),
    P(new THREE.BoxGeometry(0.44, 0.16, 0.13), '#e4e4dc', [0, 0.7, -0.34], [-0.22, 0, 0]), ...[-1, 1].map((sd) => P(new THREE.BoxGeometry(0.05, 0.05, 0.42), '#34373c', [sd * 0.28, 0.15, 0])),
    ...[-1, 1].flatMap((sd) => [P(new THREE.BoxGeometry(0.04, 0.3, 0.04), '#6a6e74', [sd * 0.2, -0.2, 0.18]), P(new THREE.BoxGeometry(0.04, 0.3, 0.04), '#6a6e74', [sd * 0.2, -0.2, -0.18]), P(new THREE.BoxGeometry(0.04, 0.04, 0.46), '#6a6e74', [sd * 0.2, -0.35, 0])]),
    P(new THREE.BoxGeometry(0.34, 0.02, 0.05), '#1b1b1b', [0.06, 0.08, 0.1], [0, 0.4, 0])).translate(0, 0.1, 0);
  const shell = (x, y, z) => (moss(x, y, z, 2.4) ? [0.42, 0.52, 0.38] : Math.abs(Math.sin(x * 18)) > 0.9 ? [0.78, 0.78, 0.78] : [1, 1, 1]); // tinted per bag by instance colour
  G.luggage = M(P(new THREE.BoxGeometry(0.72, 0.5, 0.28, 12, 4, 2), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], shell), P(new THREE.BoxGeometry(0.73, 0.51, 0.02), '#2a2a2e'),
    P(new THREE.TorusGeometry(0.08, 0.018, 4, 10, Math.PI), '#1c1c1c', [0, 0.25, 0]), ...[-1, 1].flatMap((sd) => [0.1, -0.1].map((zz) => P(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), '#151515', [sd * 0.3, -0.27, zz], [Math.PI / 2, 0, 0]))));
  // everything else that has no material of its own: painted or rusting metal, wood, cloth
  for (const k in G) if (!G[k].userData.mat) G[k].userData.mat = k === 'panel' ? TM.junkD : ['cart', 'battery', 'scrap', 'container', 'ewaste'].includes(k) ? TM.rust : TM.junk;
  return G;
}

function dolphinSwim(g, body, fl) {
  // The whole body swims: an up-down wave runs from the head back to the flukes, barely moving the head and growing
  // toward the tail stock (u is 0 at the beak, 1 at the flukes); the normals turn with the bend so the shading stays smooth
  const NOSE = 1.3, LEN = 2.5, W = 7, K = 2.6, amp = (u) => 0.03 + 0.06 * u + 0.12 * u * u, damp = (u) => 0.06 + 0.24 * u;
  const pa = body.geometry.attributes.position, na = body.geometry.attributes.normal, p0 = pa.array.slice(), n0 = na.array.slice(), nv = pa.count;
  const U = new Float32Array(nv); for (let i = 0; i < nv; i++) U[i] = Math.max(0, (NOSE - p0[i * 3 + 2]) / LEN);
  body.geometry.boundingSphere.radius += 0.25;
  const uF = (NOSE + 1.15) / LEN;
  return { root: g, anim(t, e, near) {
    const ph = t * W;
    // the flukes ride the tail tip and follow its tangent (slope dy/dz), flexed a little further
    { const a = ph - K * uF, sn = Math.sin(a); fl.position.y = amp(uF) * sn; fl.rotation.x = Math.atan((damp(uF) * sn - amp(uF) * K * Math.cos(a)) / LEN) * 1.4; }
    if (near === false) return;
    const pv = pa.array, nn = na.array;
    for (let i = 0; i < nv; i++) { const u = U[i], a = ph - K * u, sn = Math.sin(a), sl = -(damp(u) * sn - amp(u) * K * Math.cos(a)) / LEN, c = 1 / Math.sqrt(1 + sl * sl), sa = sl * c, j = i * 3;
      pv[j + 1] = p0[j + 1] + amp(u) * sn; nn[j + 1] = n0[j + 1] * c + n0[j + 2] * sa; nn[j + 2] = -n0[j + 1] * sa + n0[j + 2] * c; }
    pa.needsUpdate = true; na.needsUpdate = true; } };
}

// 부캉이, the story's guide: a young dolphin drawn to be liked. A plump body with a domed head and a short beak, big bright eyes with
// a catch-light, a blush on each cheek, the line of a smile, rounded fins with some thickness, and its teal neckerchief.
function buddyDolphin() {
  const g = new THREE.Group(), TOP = '#56a6ea', FIN = '#3d8fd6', tb = topBottom(TOP, '#f6fbff', -0.02, 0.1);
  // fins are cut from a rounded outline and given thickness; `turn` lays them in the right plane
  const fin = (pts, d, turn) => turn(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), { depth: d, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -d / 2));
  const up = (ge) => ge.rotateY(-Math.PI / 2), flat = (ge) => ge.rotateX(Math.PI / 2);
  const curve = (pts) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); sh.splineThru(pts.slice(1).map(([u, v]) => new THREE.Vector2(u, v))); sh.closePath(); return sh.getPoints(18).map((v) => [v.x, v.y]); };
  // body: plump amidships, a domed forehead raised over the lathe's own outline
  const bodyGeo = lathe([[0, -1.17], [0.09, -1.05], [0.17, -0.82], [0.27, -0.5], [0.36, -0.12], [0.41, 0.25], [0.415, 0.52], [0.39, 0.76], [0.32, 0.95], [0.22, 1.06], [0.13, 1.12], [0, 1.14]], 26);
  { const p = bodyGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i), k = Math.exp(-(((z - 0.82) / 0.24) ** 2)); if (y > 0) p.setY(i, y * (1 + 0.2 * k)); } bodyGeo.computeVertexNormals(); }
  const eye = (sx) => [P(new THREE.SphereGeometry(0.078, 16, 12), '#ffffff', [sx * 0.318, 0.125, 0.8]), P(new THREE.SphereGeometry(0.056, 14, 10), '#14212e', [sx * 0.352, 0.128, 0.822]),
    P(new THREE.SphereGeometry(0.02, 8, 6), '#ffffff', [sx * 0.388, 0.158, 0.846]), P(new THREE.SphereGeometry(0.01, 6, 4), '#ffffff', [sx * 0.397, 0.112, 0.812]),
    P(new THREE.SphereGeometry(0.052, 12, 8), '#ff9fb4', [sx * 0.33, -0.005, 0.93], [0, 0, 0], [0.45, 0.8, 1]), // the blush
    rod([sx * 0.085, -0.045, 1.3], [sx * 0.2, -0.05, 1.08], 0.009, '#2a5f93', 5), rod([sx * 0.2, -0.05, 1.08], [sx * 0.285, -0.015, 0.95], 0.009, '#2a5f93', 5)]; // the smile, running back from the beak
  const body = new THREE.Mesh(M(
    P(bodyGeo, '#fff', [0, 0, 0], [0, 0, 0], [0.95, 1, 1], tb),
    P(lathe([[0.15, 1.02], [0.125, 1.14], [0.1, 1.25], [0.065, 1.32], [0, 1.345]], 16), '#fff', [0, -0.045, 0], [0, 0, 0], [1.05, 0.72, 1], topBottom(TOP, '#f6fbff', -0.05, 0.06)), // the beak
    ...eye(1), ...eye(-1),
    P(fin(curve([[0.16, 0.34], [0.02, 0.52], [-0.14, 0.68], [-0.3, 0.74], [-0.34, 0.68], [-0.26, 0.52], [-0.3, 0.33]]), 0.06, up), FIN), // dorsal fin
    ...[1, -1].map((sx) => P(fin(curve([[sx * 0.22, 0.52], [sx * 0.4, 0.44], [sx * 0.6, 0.2], [sx * 0.62, 0.08], [sx * 0.5, 0.1], [sx * 0.32, 0.24], [sx * 0.2, 0.3]]), 0.05, flat), FIN, [0, -0.2, 0], [0, 0, -sx * 0.38])), // flippers, angled down
    // neckerchief: a band round the neck and its knot under the chin
    P(new THREE.TorusGeometry(0.405, 0.05, 10, 28), '#35b9a2', [0, 0, 0.42], [0, 0, 0], [0.96, 1, 1.5]),
    P(new THREE.ConeGeometry(0.11, 0.24, 4), '#2aa791', [0.05, -0.47, 0.44], [0.25, 0.3, 2.9], [1, 1, 0.45]), P(new THREE.ConeGeometry(0.1, 0.2, 4), '#35b9a2', [-0.07, -0.46, 0.4], [-0.1, -0.2, -2.8], [1, 1, 0.45]),
    P(new THREE.SphereGeometry(0.06, 10, 8), '#2aa791', [0, -0.4, 0.44]),
  ), MAT.vcD); g.add(body);
  const fl = new THREE.Group(); fl.position.z = -1.15;
  fl.add(new THREE.Mesh(P(fin(curve([[0, 0.12], [0.26, 0.04], [0.52, -0.16], [0.58, -0.34], [0.42, -0.36], [0.2, -0.24], [0, -0.13], [-0.2, -0.24], [-0.42, -0.36], [-0.58, -0.34], [-0.52, -0.16], [-0.26, 0.04]]), 0.05, flat), FIN), MAT.vcD)); g.add(fl);
  return dolphinSwim(g, body, fl);
}

// ---------------------------------------------------------------- small fish (instanced)
export function fishGeo(kind) {
  // [length, height, width] in metres; +z is the head, +y the back
  const [L, H, W] = { sardine: [0.45, 0.13, 0.09], lantern: [0.4, 0.12, 0.08], clownfish: [0.4, 0.2, 0.12], tang: [0.55, 0.34, 0.08], reef: [0.34, 0.2, 0.07],
    butter: [0.4, 0.36, 0.06], angel: [0.42, 0.46, 0.06], parrot: [0.85, 0.32, 0.18], idol: [0.34, 0.4, 0.05], barra: [1.4, 0.16, 0.13], snapper: [0.5, 0.16, 0.09], grouper: [1.15, 0.44, 0.34], puffer: [0.4, 0.33, 0.33], hagfish: [0.75, 0.07, 0.08], shrimp: [0.11, 0.04, 0.035] }[kind];
  const cfn = {
    sardine: (x, y) => (y > 0.01 ? [0.17, 0.33, 0.5] : [0.85, 0.9, 0.93]),
    lantern: (x, y) => (y > 0 ? [0.08, 0.1, 0.14] : [0.2, 0.24, 0.3]),
    clownfish: (x, y, z) => { const zz = z / L; const band = [0.22, -0.02, -0.28].some((b) => Math.abs(zz - b) < 0.05); const edge = [0.22, -0.02, -0.28].some((b) => Math.abs(zz - b) < 0.075); return band ? [1, 1, 1] : edge ? [0.05, 0.05, 0.05] : [1, 0.45, 0.07]; },
    reef: (x, y) => (y > 0.03 ? [0.78, 0.78, 0.8] : [1, 1, 1]), // tinted per fish by instance colour
    tang: (x, y, z) => (z < -L * 0.42 ? [1, 0.82, 0.2] : y > H * 0.1 && z < L * 0.1 && z > -L * 0.3 ? [0.05, 0.08, 0.2] : [0.12, 0.38, 0.9]),
    butter: (x, y, z) => { const zz = z / L; if (zz > 0.18 && zz < 0.28) return [0.05, 0.05, 0.05]; if (zz >= 0.28) return [0.97, 0.96, 0.92]; if (y > H * 0.28 && zz < 0.05) return [0.1, 0.1, 0.1]; return [1, 0.82, 0.08]; },
    angel: (x, y, z) => { const zz = z / L; if (zz > 0.26) return [0.95, 0.88, 0.35]; if (zz < -0.45) return [1, 0.8, 0.15]; return Math.sin(y * 62 + zz * 5) > 0.3 ? [1, 0.84, 0.18] : [0.1, 0.16, 0.5]; },
    parrot: (x, y, z) => { const zz = z / L; if (zz > 0.34) return [0.3, 0.62, 0.95]; if (Math.abs(Math.sin(z * 24 + y * 18)) > 0.9) return [0.98, 0.5, 0.62]; return y < -H * 0.2 ? [0.5, 0.9, 0.8] : [0.12, 0.76, 0.66]; },
    idol: (x, y, z) => { const zz = z / L; if ((zz > 0.04 && zz < 0.22) || zz < -0.34) return [0.05, 0.05, 0.05]; if (zz >= 0.22) return [0.98, 0.96, 0.9]; return y > H * 0.2 ? [1, 0.86, 0.25] : [0.98, 0.94, 0.8]; },
    barra: (x, y, z) => { const bar = Math.sin(z * 24) > 0.72 && y > -H * 0.05; return y > H * 0.12 ? (bar ? [0.24, 0.3, 0.36] : [0.44, 0.52, 0.6]) : [0.86, 0.9, 0.92]; },
    snapper: (x, y, z) => (Math.abs(y) < H * 0.09 || z < -L * 0.4 ? [1, 0.84, 0.1] : y > 0 ? [0.55, 0.66, 0.82] : [0.92, 0.94, 0.96]),
    grouper: (x, y, z) => { const spot = Math.sin(z * 30) * Math.sin(y * 34) * Math.sin(x * 30 + 1) > 0.3; return spot ? [0.86, 0.76, 0.56] : y > 0 ? [0.36, 0.26, 0.18] : [0.5, 0.38, 0.26]; },
    hagfish: (x, y) => (y > 0 ? [0.6, 0.45, 0.48] : [0.74, 0.6, 0.6]),
    shrimp: (x, y, z) => (z > 0.03 ? [1, 0.75, 0.62] : [0.95, 0.9, 0.86]),
    puffer: (x, y, z) => { const spot = Math.sin(z * 42) * Math.sin(x * 42) > 0.45 && y > -H * 0.1; return spot ? [0.22, 0.17, 0.1] : y < -H * 0.15 ? [0.96, 0.94, 0.86] : [0.82, 0.7, 0.46]; },
  }[kind];
  const tall = kind === 'butter' || kind === 'angel' || kind === 'idol';
  const fine = ['butter', 'angel', 'parrot', 'idol', 'grouper', 'puffer', 'barra'].includes(kind); // patterned bodies need more vertices to carry the colours
  const body = P(new THREE.SphereGeometry(0.5, fine ? 20 : 12, fine ? 14 : 8), '#fff', [0, 0, 0], [0, 0, 0], [W, H, L], cfn);
  const tail = P(vFin([[-L * 0.42, 0], [-L * 0.72, H * 0.55], [-L * 0.66, 0], [-L * 0.72, -H * 0.55]]), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => cfn(x, y, -L * 0.6));
  const dorsalPts = kind === 'idol' ? [[L * 0.12, H * 0.4], [-L * 0.45, H * 1.35], [-L * 0.2, H * 0.36]] : kind === 'angel' ? [[L * 0.12, H * 0.42], [-L * 0.45, H * 1.0], [-L * 0.36, H * 0.3]]
    : kind === 'parrot' || kind === 'grouper' ? [[L * 0.28, H * 0.4], [0, H * 0.6], [-L * 0.32, H * 0.45], [-L * 0.36, H * 0.28]] : [[L * 0.15, H * 0.42], [-L * 0.1, H * 0.8], [-L * 0.3, H * 0.3]];
  const dorsal = P(vFin(dorsalPts), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => cfn(x, y, z));
  const parts = [body, tail, dorsal];
  if (tall) parts.push(P(vFin([[L * 0.05, -H * 0.4], [-L * (kind === 'angel' ? 0.45 : 0.2), -H * (kind === 'angel' ? 1.0 : 0.75)], [-L * 0.32, -H * 0.3]]), '#fff', [0, 0, 0], [0, 0, 0], [1, 1, 1], (x, y, z) => cfn(x, y, z)));
  const er = Math.max(0.02, H * (kind === 'puffer' ? 0.16 : 0.12));
  parts.push(P(new THREE.SphereGeometry(er, 6, 4), '#050505', [W * 0.42, H * 0.08, L * 0.32]), P(new THREE.SphereGeometry(er, 6, 4), '#050505', [-W * 0.42, H * 0.08, L * 0.32]));
  return M(...parts);
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
    const body = new THREE.Mesh(M(
      P(lathe([[0, -1.2], [0.12, -0.95], [0.26, -0.4], [0.32, 0.2], [0.27, 0.7], [0.12, 0.95], [0.07, 1.25], [0, 1.3]], 14), '#fff', [0, 0, 0], [0, 0, 0], [0.85, 1, 1], tb),
      P(vFin([[0.05, 0.25], [-0.35, 0.72], [-0.4, 0.25]]), '#5d7185'),
      P(hFin([[0.2, 0.45], [0.55, 0.1], [0.2, 0.25]]), '#5d7185', [0, -0.15, 0]), P(hFin([[-0.2, 0.45], [-0.55, 0.1], [-0.2, 0.25]]), '#5d7185', [0, -0.15, 0]),
      P(new THREE.SphereGeometry(0.04, 6, 4), '#050505', [0.2, 0.08, 0.8]), P(new THREE.SphereGeometry(0.04, 6, 4), '#050505', [-0.2, 0.08, 0.8]),
    ), MAT.vcD); g.add(body);
    const fl = new THREE.Group(); fl.position.z = -1.15; fl.add(new THREE.Mesh(P(hFin([[0, 0.1], [0.55, -0.25], [0.35, -0.4], [0, -0.15], [-0.35, -0.4], [-0.55, -0.25]]), '#5d7185'), MAT.vcD)); g.add(fl);
    return dolphinSwim(g, body, fl);
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
// the net an animal is caught in: a loose, lumpy wrap with the net's mesh drawn on it
export const NET_GEO = () => { const g = new THREE.SphereGeometry(1, 24, 16), p = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + NZ(v.x * 2 + 9, v.y * 2 + v.z * 1.7) * 0.13 + NZ(v.x * 5, v.z * 5 + v.y * 4) * 0.05); p.setXYZ(i, v.x, v.y, v.z); uv.setXY(i, uv.getX(i) * 36, uv.getY(i) * 18); }
  g.computeVertexNormals(); return g; };
export const NET_MAT = () => TM.net;
export const BUDDY_MODEL = () => buddyDolphin();
