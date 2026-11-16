// The story's first-person view: the pilot looks out through one pane of glass the full width of the cabin. The cabin is
// a real model seen from the pilot's eye: a header rail with strips of cold light, a pillar each side, the dash and its
// cowl, a sonar display on the left and the arm camera's monitor on the right (each a slab on an arm, turned toward
// the pilot), a console with its own screen between the knees, and two hand controllers that move with the controls.
// The screens are canvases drawn here and shown as textures; depth, temperature, battery, hull and the compass tape
// float on the glass as flat read-outs (the same overlay mechanism as the main game's cockpit, cockpit.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { P as PG } from './models.js';
import { CockpitUI, headingDeg } from './cockpit.js';

const SANS = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const TAU = Math.PI * 2, CY = '#7fd8ff', INK = 'rgba(226,240,250,';
const Q = (o, U, V) => ({ o, U, V, w: Math.max(1, Math.round(Math.hypot(U[0], U[1]))), h: Math.max(1, Math.round(Math.hypot(V[0], V[1]))) });
const txt = (c, s, x, y, size, col, align = 'left', weight = 500) => { c.font = `${weight} ${Math.max(7, Math.round(size))}px ${SANS}`; c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); };
function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function sphereLayout(W, H, touch) {
  const L = { W, H, touch, q: {}, gauges: [] };
  L.view = { x: 0, y: 0, w: W, h: H }; // one pane of glass, the full width and height of the cabin
  // only the read-outs that float on the glass are flat overlays; the displays, console and controllers are solid things in the scene
  L.q.hudL = Q([W * 0.045, H * 0.035], [W * 0.135, H * 0.014], [0, H * 0.17]);
  L.q.hudR = Q([W * 0.862, Math.max(H * 0.085, 50)], [W * 0.13, -H * 0.014], [0, H * 0.17]);
  L.q.comp = Q([W * 0.37, Math.max(4, H * 0.012)], [W * 0.26, 0], [0, Math.max(34, H * 0.072)]);
  L.ppY = H * (0.5 - Math.tan(SEAT.look) / (2 * Math.tan((SEAT.fov * Math.PI) / 360))); L.hudTop = L.q.comp.o[1] + L.q.comp.h + 4; // (the heading sits above the middle of the pane: the view is tipped down)
  return L;
}

// ---------------------------------------------------------------- the cabin, modelled
// Everything is placed about the pilot's eye (the group's origin; +z ahead, +x the pilot's left, in the sub's own space) and belongs
// to the sub, so when the view turns a little ahead of the hull the near things slide across the far ones as they would for a head.
export const EYE = [0, 0.12, 0.55];
// under way the pilot sits back from the glass and looks a little down, so the console and controllers stay in view; working the arm, they lean in to EYE
export const SEAT = { back: 0.24, look: 0.19, fov: 72 };
export function buildCockpit3D() {
  const g = new THREE.Group(); g.position.set(...EYE); g.visible = false;
  // cabin surfaces: lit by the light that comes through the glass, plus a little of their own so they never go black in the deep
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45, fog: false });
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.3;'); };
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }); glow.color.setScalar(1.25);
  const Dk = '#1c232b', Md = '#2c3742', Lt = '#46535f', Bk = '#0c1014', V = (x, y, z) => new THREE.Vector3(x, y, z);
  const dir = (az, el, d) => V(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  const solid = (geos, m = mat) => new THREE.Mesh(mergeGeometries(geos), m);
  const box = (w, h, d, col, x = 0, y = 0, z = 0, rot = [0, 0, 0]) => PG(new THREE.BoxGeometry(w, h, d), col, [x, y, z], rot);
  const arc = (R, y, a0, a1, tube, seg, col, sy = 1) => { const c = new THREE.Curve(); c.getPoint = (t) => { const a = a0 + (a1 - a0) * t; return V(Math.sin(a) * R, y, Math.cos(a) * R); }; const ge = new THREE.TubeGeometry(c, seg, tube, 8, false); ge.scale(1, sy, 1); ge.translate(0, y * (1 - sy), 0); return PG(ge, col); };
  const screen = (w, h, cw, ch) => { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false })); m.material.color.setScalar(0.92); const c = cv.getContext('2d'); c.fillStyle = '#04101c'; c.fillRect(0, 0, cw, ch); return { cv, c, tex, mesh: m, w: cw, h: ch }; }; // (dark until its first picture)
  // the frame of the pane: a header rail arching round overhead with strips of cold light under it, a pillar each side, the cowl below
  g.add(solid([arc(1.02, 0.56, -1.25, 1.25, 0.065, 40, Md, 0.7), arc(1.0, 0.5, -1.25, 1.25, 0.03, 40, Dk), arc(1.03, -0.68, -1.4, 1.4, 0.08, 44, Md, 0.75),
    ...[1, -1].flatMap((s) => [PG(new THREE.CylinderGeometry(0.045, 0.055, 1.3, 10), Md, [Math.sin(s * 0.98) * 1.02, -0.06, Math.cos(0.98) * 1.02]), PG(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), Lt, [Math.sin(s * 0.98) * 1.02, 0.54, Math.cos(0.98) * 1.02])])]));
  g.add(solid([arc(0.985, 0.495, 0.3, 0.72, 0.012, 12, '#fff'), arc(0.985, 0.495, -0.72, -0.3, 0.012, 12, '#fff'), arc(1.0, -0.615, 0.5, 0.78, 0.008, 8, '#cfeaff'), arc(1.0, -0.615, -0.78, -0.5, 0.008, 8, '#cfeaff')], glow));
  // the dash: a dark shelf from the cowl back toward the pilot, with a padded roll along its near edge
  g.add(solid([PG(new THREE.RingGeometry(0.46, 1.03, 48, 1, -Math.PI / 2 - 1.4, 2.8).rotateX(-Math.PI / 2), Bk, [0, -0.73, 0]), PG(new THREE.CircleGeometry(0.62, 32).rotateX(-Math.PI / 2), Bk, [0, -0.8, 0.02]), arc(0.47, -0.72, -1.4, 1.4, 0.03, 36, Dk)]));
  // a display: a slab with a bezel on an arm, turned to face the pilot
  const display = (az, el, d, w, h, cw, ch) => { const o = new THREE.Group(), s = screen(w, h, cw, ch); o.position.copy(dir(az, el, d)); o.lookAt(V(0, 0.02, -0.25)); // (a point just behind the eye: turned in, not quite square on)
    o.add(solid([box(w + 0.06, h + 0.06, 0.04, Dk, 0, 0, -0.021), box(w + 0.075, 0.012, 0.05, Lt, 0, h / 2 + 0.036, -0.018), box(w + 0.075, 0.012, 0.05, Bk, 0, -h / 2 - 0.036, -0.018),
      box(0.07, 0.05, 0.09, Md, 0, -h / 2 - 0.02, -0.08), PG(new THREE.CylinderGeometry(0.022, 0.028, 0.5, 8), Md, [0, -h / 2 - 0.27, -0.1])]));
    s.mesh.position.z = 0.001; o.add(s.mesh); g.add(o); return s; };
  const sonar = display(0.76, -0.03, 0.84, 0.3, 0.21, 432, 300), cam = display(-0.76, -0.05, 0.84, 0.3, 0.19, 384, 243);
  { const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4b3a, fog: false })); led.material.color.setRGB(3, 0.5, 0.4); cam.mesh.parent.add(led); led.position.set(0.13, 0.12, 0.002); }
  // the console: a wedge between the knees, its face (and screen) tilted up at the pilot under a small hood
  const con = new THREE.Group(), cs = screen(0.5, 0.25, 512, 256); con.position.set(0, -0.63, 0.58); con.lookAt(V(0, 0.02, 0)); // low enough to leave the arm's work in clear view above it
  con.add(solid([box(0.6, 0.34, 0.3, Md, 0, 0, -0.151), box(0.62, 0.03, 0.1, Lt, 0, 0.175, 0.02), box(0.03, 0.34, 0.06, Dk, 0.3, 0, 0), box(0.03, 0.34, 0.06, Dk, -0.3, 0, 0), box(0.52, 0.27, 0.01, Bk, 0, 0, -0.004),
    box(0.5, 0.5, 0.26, Dk, 0, -0.38, -0.2), ...[1, -1].flatMap((s) => [PG(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12).rotateX(Math.PI / 2), Lt, [s * 0.275, 0.11, 0.035]), PG(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12).rotateX(Math.PI / 2), Lt, [s * 0.275, -0.1, 0.035])])]));
  con.add(solid([PG(new THREE.CylinderGeometry(0.008, 0.008, 0.022, 10).rotateX(Math.PI / 2), '#8fe6ff', [0.275, 0.05, 0.036]), PG(new THREE.CylinderGeometry(0.008, 0.008, 0.022, 10).rotateX(Math.PI / 2), '#8fe6ff', [-0.275, -0.04, 0.036])], glow));
  cs.mesh.position.z = 0.002; con.add(cs.mesh); g.add(con);
  // the two hand controllers on their armrest pods; each pivots at its foot and carries a ring of light at the thumb
  const sticks = [1, -1].map((s) => { const pod = solid([box(0.2, 0.1, 0.5, Md, 0, 0, 0), box(0.22, 0.02, 0.52, Lt, 0, 0.055, 0), PG(new THREE.CylinderGeometry(0.06, 0.075, 0.04, 16), Dk, [0, 0.08, 0.08])]); pod.position.set(s * 0.4, -0.67, 0.32); pod.rotation.y = s * 0.3; g.add(pod);
    const piv = new THREE.Group(); piv.position.set(0, 0.09, 0.08); pod.add(piv);
    piv.add(solid([PG(new THREE.CylinderGeometry(0.03, 0.036, 0.17, 14), Bk, [0, 0.085, 0]), PG(new THREE.CapsuleGeometry(0.043, 0.07, 4, 14), Md, [0, 0.2, 0]), box(0.06, 0.03, 0.05, Dk, 0, 0.255, -0.02, [-0.5, 0, 0])]));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.003, 8, 24), glow.clone()); ring.material.vertexColors = false; ring.material.color.setRGB(0.55, 0.85, 0.95); ring.position.set(0, 0.235, -0.046); ring.rotation.x = 0.35; piv.add(ring); return piv; });
  return { group: g, sonar, cam, console: cs, sticks, t: { sonar: 1, console: 1 } };
}

// ---------------------------------------------------------------- the live screens
const scrBase = (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#061a2c'); g.addColorStop(1, '#030b14'); c.fillStyle = g; c.fillRect(0, 0, w, h); };
function drawSonar(c, w, h, st) {
  scrBase(c, w, h); const k = h / 250, ox = w * 0.44, oy = h * 0.6, R = h * 0.5, range = 60;
  txt(c, '소나', 12 * k, 30 * k, 22 * k, INK + '.9)', 'left', 600);
  c.save(); c.beginPath(); c.rect(0, 40 * k, w * 0.86, h); c.clip();
  c.strokeStyle = 'rgba(110,190,240,.35)'; c.lineWidth = 1; for (const f of [0.34, 0.67, 1]) { c.beginPath(); c.arc(ox, oy, R * f, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(ox - R, oy); c.lineTo(ox + R, oy); c.moveTo(ox, oy - R); c.lineTo(ox, oy + R); c.stroke();
  const sw = (st.t * 1.6) % TAU, gr = c.createConicGradient ? c.createConicGradient(sw - 1.1, ox, oy) : null;
  if (gr) { gr.addColorStop(0, 'rgba(70,170,255,0)'); gr.addColorStop(0.17, 'rgba(90,190,255,.4)'); gr.addColorStop(0.175, 'rgba(70,170,255,0)'); gr.addColorStop(1, 'rgba(70,170,255,0)'); c.fillStyle = gr; c.beginPath(); c.arc(ox, oy, R, 0, TAU); c.fill(); }
  // what is around the sub, turned so that ahead is up: the seabed's relief as a faint cloud, litter as dots, the goal as a ring
  const cs = Math.cos(st.yaw), sn = Math.sin(st.yaw), put = (p) => { const dx = p.x - st.pos.x, dz = p.z - st.pos.z, r = -(dx * cs - dz * sn), f = dx * sn + dz * cs; return [ox + (r / range) * R, oy - (f / range) * R, Math.hypot(dx, dz)]; };
  for (let i = 0; i < 70; i++) { const a = i * 2.39996, d = Math.sqrt((i + 0.5) / 70) * range, x = st.pos.x + Math.cos(a) * d, z = st.pos.z + Math.sin(a) * d, hh = st.heightAt(x, z) - st.pos.y, [px, py] = put({ x, z });
    c.fillStyle = `rgba(80,170,255,${Math.max(0.05, Math.min(0.5, 0.3 + hh * 0.03))})`; c.fillRect(px - 2 * k, py - 2 * k, 4 * k, 4 * k); }
  for (const it of st.items) { if (it.col || it.locked) continue; const [px, py, d] = put(it.pos); if (d > range) continue; c.fillStyle = '#d8f2ff'; c.beginPath(); c.arc(px, py, 3.2 * k, 0, TAU); c.fill(); }
  if (st.target) { const [px, py, d] = put(st.target), kk = d > range ? range / d : 1, x = ox + (px - ox) * kk, y = oy + (py - oy) * kk; c.strokeStyle = '#e3bd5f'; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, (6 + Math.sin(st.t * 5) * 1.5) * k, 0, TAU); c.stroke(); }
  c.fillStyle = '#eaf6ff'; c.beginPath(); c.moveTo(ox, oy - 8 * k); c.lineTo(ox + 6 * k, oy + 6 * k); c.lineTo(ox - 6 * k, oy + 6 * k); c.closePath(); c.fill(); c.restore();
  c.strokeStyle = INK + '.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(w * 0.885, h * 0.14); c.lineTo(w * 0.885, h * 0.9); c.stroke();
  [0, 20, 40, 60].forEach((v, i) => { const y = h * (0.14 + i * 0.253); c.beginPath(); c.moveTo(w * 0.885, y); c.lineTo(w * 0.905, y); c.stroke(); txt(c, String(v), w * 0.918, y + 5 * k, 14 * k, INK + '.8)'); });
}
function drawCamTag(c, w, h, st, live) {
  const k = h / 220;
  if (!live) { scrBase(c, w, h); c.strokeStyle = 'rgba(110,190,240,.25)'; c.lineWidth = 1; for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, (h * i) / 6); c.lineTo(w, (h * i) / 6); c.stroke(); } txt(c, '팔 카메라 대기', w / 2, h * 0.55, 16 * k, INK + '.6)', 'center'); }
  const g = c.createLinearGradient(0, 0, 0, 44 * k); g.addColorStop(0, 'rgba(2,8,14,.7)'); g.addColorStop(1, 'rgba(2,8,14,0)'); c.fillStyle = g; c.fillRect(0, 0, w, 44 * k);
  txt(c, '카메라', 12 * k, 27 * k, 19 * k, INK + '.92)', 'left', 600);
}
function drawConsole(c, w, h, st) {
  scrBase(c, w, h); const k = h / 160, box = (x, y, bw, bh) => { rrect(c, x, y, bw, bh, 5 * k); c.strokeStyle = 'rgba(120,200,255,.3)'; c.lineWidth = 1; c.stroke(); };
  box(w * 0.04, h * 0.1, w * 0.27, h * 0.8);
  txt(c, '속도', w * 0.07, h * 0.3, 15 * k, INK + '.7)'); txt(c, `${st.speed.toFixed(1)} m/s`, w * 0.07, h * 0.47, 22 * k, '#eaf6ff', 'left', 600);
  txt(c, '수심', w * 0.07, h * 0.68, 15 * k, INK + '.7)'); txt(c, `${st.depth.toFixed(1)} m`, w * 0.07, h * 0.85, 22 * k, '#eaf6ff', 'left', 600);
  // attitude: range rings round the sub's plan view, which banks with the turn
  const ox = w * 0.5, oy = h * 0.5, R = h * 0.4; c.strokeStyle = 'rgba(120,200,255,.55)'; c.lineWidth = 1.2;
  for (const f of [0.55, 0.78, 1]) { c.beginPath(); c.arc(ox, oy, R * f, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(ox - R * 1.08, oy); c.lineTo(ox - R * 0.5, oy); c.moveTo(ox + R * 0.5, oy); c.lineTo(ox + R * 1.08, oy); c.moveTo(ox, oy - R * 1.08); c.lineTo(ox, oy - R * 0.5); c.moveTo(ox, oy + R * 0.5); c.lineTo(ox, oy + R * 1.08); c.stroke();
  for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; c.beginPath(); c.moveTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R); c.lineTo(ox + Math.cos(a) * R * (i % 3 ? 0.95 : 0.9), oy + Math.sin(a) * R * (i % 3 ? 0.95 : 0.9)); c.stroke(); }
  c.save(); c.translate(ox, oy); c.rotate(st.bank || 0); c.shadowColor = CY; c.shadowBlur = 8 * k; c.fillStyle = '#cdeeff';
  c.beginPath(); c.moveTo(0, -R * 0.42); c.quadraticCurveTo(R * 0.13, -R * 0.2, R * 0.11, R * 0.1); c.lineTo(R * 0.3, R * 0.3); c.lineTo(R * 0.11, R * 0.26); c.lineTo(R * 0.07, R * 0.4); c.lineTo(-R * 0.07, R * 0.4); c.lineTo(-R * 0.11, R * 0.26); c.lineTo(-R * 0.3, R * 0.3); c.lineTo(-R * 0.11, R * 0.1); c.quadraticCurveTo(-R * 0.13, -R * 0.2, 0, -R * 0.42); c.fill(); c.restore();
  // battery as a column of cells, and the litter stowed so far
  box(w * 0.69, h * 0.1, w * 0.27, h * 0.8); const n = 9, lit = Math.round(st.bat * n);
  for (let i = 0; i < n; i++) { c.fillStyle = i < lit ? (st.bat < 0.25 ? '#ffb43a' : '#9fdcff') : 'rgba(120,200,255,.14)'; c.fillRect(w * 0.725, h * (0.8 - i * 0.073), w * 0.05, h * 0.05); }
  txt(c, '수거', w * 0.81, h * 0.32, 15 * k, INK + '.7)'); txt(c, st.prog ? `${st.prog[0]}/${st.prog[1]}` : '-', w * 0.81, h * 0.52, 26 * k, '#eaf6ff', 'left', 600);
  txt(c, st.heading, w * 0.81, h * 0.8, 14 * k, INK + '.7)');
}
function drawReadL(c, w, h, st) { c.clearRect(0, 0, w, h); const k = h / 190; c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 6 * k;
  txt(c, '수심', 4 * k, 26 * k, 21 * k, INK + '.8)'); txt(c, st.depth.toFixed(1), 4 * k, 68 * k, 40 * k, '#f2f8fc', 'left', 600); const tw = c.measureText(st.depth.toFixed(1)).width; txt(c, 'm', 12 * k + tw, 68 * k, 24 * k, INK + '.85)');
  c.fillStyle = INK + '.3)'; c.fillRect(2 * k, 86 * k, w * 0.78, 1);
  txt(c, '수온', 4 * k, 118 * k, 21 * k, INK + '.8)'); txt(c, st.temp.toFixed(1), 4 * k, 160 * k, 40 * k, '#f2f8fc', 'left', 600); const t2 = c.measureText(st.temp.toFixed(1)).width; txt(c, '°C', 12 * k + t2, 160 * k, 24 * k, INK + '.85)'); c.shadowBlur = 0; }
function drawReadR(c, w, h, st) { c.clearRect(0, 0, w, h); const k = h / 190, pct = (v) => String(Math.round(v * 100)); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 6 * k;
  const row = (y, label, v, icon) => { txt(c, label, 4 * k, y, 21 * k, INK + '.8)'); txt(c, pct(v), 4 * k, y + 42 * k, 40 * k, v < 0.25 ? '#ffb43a' : '#f2f8fc', 'left', 600); const tw = c.measureText(pct(v)).width; txt(c, '%', 12 * k + tw, y + 42 * k, 24 * k, INK + '.85)'); icon(Math.min(w - 34 * k, 12 * k + tw + 44 * k), y + 26 * k, v); };
  row(26 * k, '배터리', st.bat, (x, y, v) => { c.strokeStyle = '#f2f8fc'; c.lineWidth = 2 * k; rrect(c, x, y - 11 * k, 40 * k, 22 * k, 4 * k); c.stroke(); c.fillStyle = '#f2f8fc'; c.fillRect(x + 41 * k, y - 5 * k, 4 * k, 10 * k); for (let i = 0; i < 4; i++) if (v > i / 4 + 0.05) c.fillRect(x + (4 + i * 8.5) * k, y - 7 * k, 6 * k, 14 * k); });
  c.fillStyle = INK + '.3)'; c.fillRect(2 * k, 86 * k, w * 0.78, 1);
  row(118 * k, '선체', st.hull, (x, y, v) => { c.lineWidth = 5 * k; c.strokeStyle = INK + '.25)'; c.beginPath(); c.arc(x + 20 * k, y, 17 * k, 0, TAU); c.stroke(); c.strokeStyle = '#f2f8fc'; c.beginPath(); c.arc(x + 20 * k, y, 17 * k, -Math.PI / 2, -Math.PI / 2 + TAU * v); c.stroke(); }); c.shadowBlur = 0; }
function drawCompass(c, w, h, st) { c.clearRect(0, 0, w, h); const k = h / 68, deg = headingDeg(st.yaw), span = 150, y = 26 * k; c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 5 * k;
  c.strokeStyle = INK + '.85)'; c.fillStyle = '#f2f8fc'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  for (let d = Math.ceil((deg - span / 2) / 15) * 15; d <= deg + span / 2; d += 15) { const x = w / 2 + ((d - deg) / span) * w, m = ((d % 360) + 360) % 360, big = m % 90 === 0; c.beginPath(); c.moveTo(x, y - (big ? 9 : 5) * k); c.lineTo(x, y + (big ? 9 : 5) * k); c.stroke();
    if (big) txt(c, 'NESW'[m / 90], x, y + 34 * k, 22 * k, '#f2f8fc', 'center', 600); }
  c.beginPath(); c.moveTo(w / 2, y - 12 * k); c.lineTo(w / 2 - 8 * k, y - 25 * k); c.lineTo(w / 2 + 8 * k, y - 25 * k); c.closePath(); c.fill(); c.shadowBlur = 0; }
const ARM_SAY = { idle: ['대기', 0], unfold: ['펼치는 중…', 0.2], aim: ['손을 쓰레기 위로', 0.45], close: ['잡는 중…', 0.7], miss: ['다시 조준', 0.45], carry: ['회수 중…', 0.9] };
// the arm's state, along the foot of the console screen: what it is doing and how far along
function drawManip(c, w, h, st) { const k = h / 256, a = st.arm, key = !a.on ? 'idle' : a.first ? 'unfold' : a.phase, [say, p0] = ARM_SAY[key] || ARM_SAY.idle, p = key === 'carry' ? 0.75 + 0.25 * Math.min(1, a.t / 0.8) : key === 'aim' && a.aimed ? 0.62 : p0, y = h * 0.86;
  c.fillStyle = 'rgba(3,10,18,.9)'; c.fillRect(0, h * 0.775, w, h * 0.225); c.fillStyle = 'rgba(120,200,255,.3)'; c.fillRect(0, h * 0.775, w, 1);
  txt(c, '로봇 팔', 14 * k, y + 8 * k, 22 * k, '#f2f8fc', 'left', 600); txt(c, say, 110 * k, y + 8 * k, 21 * k, a.aimed ? '#e3bd5f' : INK + '.85)');
  rrect(c, w * 0.6, y - 5 * k, w * 0.37, 11 * k, 5 * k); c.fillStyle = INK + '.2)'; c.fill(); if (p > 0) { rrect(c, w * 0.6, y - 5 * k, w * 0.37 * p, 11 * k, 5 * k); c.fillStyle = a.aimed ? '#e3bd5f' : '#cfe9fb'; c.fill(); } }
// redraws the cabin's screens (each a few times a second) and moves the controllers with the pilot's hands
export function updateCockpit3D(K, st, dt) {
  K.t.sonar += dt; if (K.t.sonar > 1 / 12) { K.t.sonar = 0; drawSonar(K.sonar.c, K.sonar.w, K.sonar.h, st); K.sonar.tex.needsUpdate = true; }
  K.t.console += dt; if (K.t.console > 1 / 8) { K.t.console = 0; drawConsole(K.console.c, K.console.w, K.console.h * 0.775, st); drawManip(K.console.c, K.console.w, K.console.h, st); K.console.tex.needsUpdate = true;
    if (!st.camOn) { drawCamTag(K.cam.c, K.cam.w, K.cam.h, st); K.cam.tex.needsUpdate = true; } }
  const e = Math.min(1, dt * 10), [l, r] = K.sticks; // left hand: where to go (or the arm's hand); right hand: where to look
  l.rotation.x += (st.stickL[1] * 0.28 - l.rotation.x) * e; l.rotation.z += (st.stickL[0] * 0.28 - l.rotation.z) * e;
  r.rotation.x += (st.stickR[1] * 0.2 - r.rotation.x) * e; r.rotation.z += (st.stickR[0] * 0.28 - r.rotation.z) * e;
}
// the arm camera's picture arrives as a corner of the WebGL canvas; it is copied onto the monitor's canvas and labelled
export function feedCockpit3D(K, src, sw, sh, st) { K.cam.c.drawImage(src, 0, src.height - sh, sw, sh, 0, 0, K.cam.w, K.cam.h); drawCamTag(K.cam.c, K.cam.w, K.cam.h, st, true); K.cam.tex.needsUpdate = true; }

export class SphereUI extends CockpitUI {
  update(st, dt) {
    this.run('hudL', 1 / 5, dt, (c, w, h) => drawReadL(c, w, h, st));
    this.run('hudR', 1 / 5, dt, (c, w, h) => drawReadR(c, w, h, st));
    this.run('comp', 1 / 20, dt, (c, w, h) => drawCompass(c, w, h, st));
  }
}
