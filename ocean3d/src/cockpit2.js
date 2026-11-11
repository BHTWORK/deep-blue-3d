// The story's first-person view: the pilot looks out through one big round window. A dark ring with strips of cold
// light frames the sea; a sonar display stands on the left, the arm camera's monitor on the right, a console with
// its own screen and two hand controllers below; depth, temperature, battery and hull read out in the top corners
// and a compass tape runs along the top. The frame is painted once per size; the screens are small canvases
// laid over it (the same mechanism as the main game's cockpit, cockpit.js).
import { CockpitUI, headingDeg } from './cockpit.js';

const SANS = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const TAU = Math.PI * 2, CY = '#7fd8ff', INK = 'rgba(226,240,250,';
const Q = (o, U, V) => ({ o, U, V, w: Math.max(1, Math.round(Math.hypot(U[0], U[1]))), h: Math.max(1, Math.round(Math.hypot(V[0], V[1]))) });
const txt = (c, s, x, y, size, col, align = 'left', weight = 500) => { c.font = `${weight} ${Math.max(7, Math.round(size))}px ${SANS}`; c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); };
function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function sphereLayout(W, H, touch) {
  const cx = W / 2, cy = H * 0.4, rx = W * 0.315, ry = H * 0.375, L = { W, H, touch, win: { cx, cy, rx, ry }, q: {}, gauges: [] };
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H, Math.ceil(cy + ry));
  L.view = { x: Math.floor(cx - rx), y: y0, w: Math.ceil(rx * 2), h: y1 - y0 }; // the 3D picture is only drawn where the window is
  L.q.scrL = Q([W * 0.008, H * 0.3], [W * 0.214, H * 0.036], [W * 0.004, H * 0.28]);
  L.q.scrR = Q([W * 0.79, H * 0.34], [W * 0.205, -H * 0.03], [-W * 0.003, H * 0.245]);
  L.q.scrC = Q([W * 0.358, H * 0.787], [W * 0.284, 0], [0, H * 0.168]);
  L.q.hudL = Q([W * 0.07, H * 0.035], [W * 0.135, H * 0.014], [0, H * 0.17]);
  L.q.hudR = Q([W * 0.85, Math.max(H * 0.085, 50)], [W * 0.135, -H * 0.014], [0, H * 0.17]);
  L.q.comp = Q([W * 0.37, Math.max(4, H * 0.012)], [W * 0.26, 0], [0, Math.max(34, H * 0.072)]);
  if (!touch) L.q.manip = Q([W * 0.872, H * 0.722], [W * 0.118, H * 0.012], [0, H * 0.118]); // on touch the grab button stands there
  L.ppY = y0 + (y1 - y0) / 2; L.hudTop = L.q.comp.o[1] + L.q.comp.h + 4;
  return L;
}

// ---------------------------------------------------------------- the painted frame
export function drawSphereCockpit(cv, L, pr) {
  const { W, H } = L, { cx, cy, rx, ry } = L.win, u = W / 1672;
  cv.width = Math.round(W * pr); cv.height = Math.round(H * pr); const c = cv.getContext('2d'); c.setTransform(pr, 0, 0, pr, 0, 0); c.clearRect(0, 0, W, H);
  const lin = (x0, y0, x1, y1, st) => { const g = c.createLinearGradient(x0, y0, x1, y1); st.forEach(([t, col]) => g.addColorStop(t, col)); return g; };
  const ell = (k) => { c.beginPath(); c.ellipse(cx, cy, rx + k * u, ry + k * u, 0, 0, TAU); };
  // walls: dark padded panels, a little lighter toward the window
  let g = c.createRadialGradient(cx, cy, rx * 0.9, cx, cy, W * 0.62); g.addColorStop(0, '#1c2530'); g.addColorStop(0.45, '#0e141b'); g.addColorStop(1, '#05080c'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(120,150,175,.07)'; c.lineWidth = 1.2 * u;
  for (const sx of [-1, 1]) { for (let i = 0; i < 4; i++) { const x = cx + sx * (rx + (95 + i * 105) * u); c.beginPath(); c.moveTo(x, 0); c.lineTo(x + sx * 30 * u, H); c.stroke(); }
    for (const y of [0.2, 0.66, 0.9]) { c.beginPath(); c.moveTo(cx + sx * (rx + 60 * u), H * y); c.lineTo(cx + sx * W * 0.5, H * (y + 0.03)); c.stroke(); } }
  // the window ring: a broad band of dark metal with a machined inner lip
  ell(86); c.fillStyle = lin(0, cy - ry, 0, cy + ry + 86 * u, [[0, '#1b232d'], [0.5, '#232d38'], [1, '#0c1016']]); c.fill();
  ell(86); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 3 * u; c.stroke();
  ell(58); c.strokeStyle = 'rgba(150,180,205,.10)'; c.lineWidth = 1.5 * u; c.stroke();
  ell(30); c.fillStyle = lin(0, cy - ry, 0, cy + ry, [[0, '#2a3440'], [0.5, '#161d25'], [1, '#2b3743']]); c.fill();
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU + 0.11, x = cx + Math.cos(a) * (rx + 71 * u), y = cy + Math.sin(a) * (ry + 71 * u); c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(x, y, 4.2 * u, 0, TAU); c.fill(); c.fillStyle = 'rgba(160,185,205,.22)'; c.beginPath(); c.arc(x - u, y - u, 2.2 * u, 0, TAU); c.fill(); }
  // strips of cold light set into the lip: upper left and right, lower left and right
  c.save(); c.lineCap = 'round'; c.shadowColor = '#9fdcff'; c.shadowBlur = 22 * u;
  for (const [a0, a1, w, al] of [[-2.36, -1.95, 9, 1], [-1.19, -0.78, 9, 1], [2.38, 2.66, 7, 0.9], [0.48, 0.76, 7, 0.9], [-3.02, -2.62, 3, 0.55], [-0.52, -0.12, 3, 0.55]]) {
    c.strokeStyle = `rgba(214,240,255,${al})`; c.lineWidth = w * u; c.beginPath(); c.ellipse(cx, cy, rx + 14 * u, ry + 14 * u, 0, a0, a1); c.stroke(); }
  c.restore();
  // the glass itself
  c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; ell(0); c.fill(); c.restore();
  // the pane is thick: it darkens toward its rim and carries a faint reflection of the cabin lights
  c.save(); ell(0); c.clip(); g = c.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.72, cx, cy, Math.max(rx, ry)); g.addColorStop(0, 'rgba(2,10,18,0)'); g.addColorStop(1, 'rgba(2,10,18,.5)'); c.fillStyle = g; c.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  c.translate(cx - rx * 0.42, cy - ry * 0.45); c.rotate(-0.5); g = c.createLinearGradient(0, -60 * u, 0, 60 * u); g.addColorStop(0, 'rgba(200,230,255,0)'); g.addColorStop(0.5, 'rgba(200,230,255,.07)'); g.addColorStop(1, 'rgba(200,230,255,0)'); c.fillStyle = g; c.fillRect(-rx * 0.5, -60 * u, rx, 120 * u); c.restore();
  ell(1.5); c.strokeStyle = 'rgba(190,225,250,.35)'; c.lineWidth = 2 * u; c.stroke(); ell(6); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 6 * u; c.stroke();
  // the two displays: a thick bezel round each screen, on a short bracket
  const bezel = (q, pad, side) => { const [ox, oy] = q.o, U = q.U, V = q.V, nU = [U[0] / q.w, U[1] / q.w], nV = [V[0] / q.h, V[1] / q.h], P = (a, b) => [ox + nU[0] * a + nV[0] * b, oy + nU[1] * a + nV[1] * b];
    const poly = (p) => { c.beginPath(); const pts = [P(-p, -p), P(q.w + p, -p), P(q.w + p, q.h + p), P(-p, q.h + p)]; c.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2); for (let i = 1; i <= 4; i++) c.arcTo(pts[i % 4][0], pts[i % 4][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], 14 * u); c.closePath(); };
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 26 * u; c.shadowOffsetY = 8 * u; poly(pad); c.fillStyle = '#0a0d11'; c.fill(); c.restore();
    poly(pad); c.strokeStyle = 'rgba(150,180,205,.28)'; c.lineWidth = 1.6 * u; c.stroke(); poly(pad * 0.35); c.fillStyle = '#02050a'; c.fill();
    const m = P(side < 0 ? q.w * 0.3 : q.w * 0.7, q.h + pad); c.fillStyle = '#0c1015'; c.fillRect(m[0] - 22 * u, m[1], 44 * u, 60 * u); };
  bezel(L.q.scrL, 20 * u, -1); bezel(L.q.scrR, 20 * u, 1);
  { const [x, y] = L.q.scrR.o; c.fillStyle = '#ff4b3a'; c.shadowColor = '#ff4b3a'; c.shadowBlur = 10 * u; c.beginPath(); c.arc(x + L.q.scrR.w - 6 * u, y - 46 * u, 6 * u, 0, TAU); c.fill(); c.shadowBlur = 0; }
  // the console: a wedge rising toward the window, with the screen set in it
  const top = H * 0.735, cw0 = W * 0.165, cw1 = W * 0.2;
  c.save(); c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 30 * u; c.beginPath(); c.moveTo(cx - cw1, H + 4); c.lineTo(cx - cw0, top + 18 * u); c.quadraticCurveTo(cx - cw0 + 6 * u, top, cx - cw0 + 30 * u, top); c.lineTo(cx + cw0 - 30 * u, top); c.quadraticCurveTo(cx + cw0 - 6 * u, top, cx + cw0, top + 18 * u); c.lineTo(cx + cw1, H + 4); c.closePath();
  c.fillStyle = lin(0, top, 0, H, [[0, '#2a333d'], [0.12, '#171d24'], [1, '#090c10']]); c.fill(); c.restore();
  c.strokeStyle = 'rgba(160,190,215,.3)'; c.lineWidth = 1.5 * u; c.beginPath(); c.moveTo(cx - cw0 + 30 * u, top + 1); c.lineTo(cx + cw0 - 30 * u, top + 1); c.stroke();
  { const q = L.q.scrC, p = 12 * u; rrect(c, q.o[0] - p, q.o[1] - p, q.w + p * 2, q.h + p * 2, 16 * u); c.fillStyle = '#05080c'; c.fill(); c.strokeStyle = 'rgba(150,180,205,.25)'; c.lineWidth = 1.4 * u; c.stroke(); }
  for (const sx of [-1, 1]) for (const [dy, r] of [[40, 9], [150, 7]]) { const x = cx + sx * (cw0 - 4 * u + dy * 0.12 * u), y = top + dy * u; c.fillStyle = '#05070a'; c.beginPath(); c.arc(x, y, (r + 4) * u, 0, TAU); c.fill(); c.fillStyle = sx * dy > 100 ? '#3fbfe6' : '#27313b'; c.beginPath(); c.arc(x, y, r * 0.6 * u, 0, TAU); c.fill(); }
  // armrests with the two hand controllers, each with a ring of light at its thumb
  for (const sx of [-1, 1]) { const x = cx + sx * W * 0.315, y = H * 0.8;
    c.beginPath(); c.moveTo(cx + sx * cw1, H + 4); c.lineTo(cx + sx * (cw0 + 20 * u), H * 0.83); c.lineTo(cx + sx * W * 0.5, H * 0.79); c.lineTo(cx + sx * W * 0.5, H + 4); c.closePath(); c.fillStyle = lin(0, H * 0.79, 0, H, [[0, '#1d252d'], [0.2, '#10151b'], [1, '#07090d']]); c.fill();
    c.strokeStyle = 'rgba(140,170,195,.18)'; c.lineWidth = 1.2 * u; c.beginPath(); c.moveTo(cx + sx * (cw0 + 20 * u), H * 0.83); c.lineTo(cx + sx * W * 0.5, H * 0.79); c.stroke();
    c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 20 * u; c.translate(x, y); c.rotate(-sx * 0.1);
    rrect(c, -62 * u, 6 * u, 124 * u, 260 * u, 40 * u); c.fillStyle = lin(-62 * u, 0, 62 * u, 0, [[0, '#090c10'], [0.4, '#2a323b'], [0.7, '#161b21'], [1, '#07090c']]); c.fill();
    rrect(c, -70 * u, -52 * u, 140 * u, 112 * u, 38 * u); c.fillStyle = lin(0, -52 * u, 0, 60 * u, [[0, '#3a434d'], [0.5, '#1b2128'], [1, '#0d1014']]); c.fill();
    c.strokeStyle = 'rgba(170,200,225,.22)'; c.lineWidth = 1.5 * u; c.stroke(); c.restore();
    c.save(); c.translate(x, y); c.rotate(-sx * 0.1); c.shadowColor = CY; c.shadowBlur = 16 * u; c.strokeStyle = '#bfeaff'; c.lineWidth = 4.5 * u; c.beginPath(); c.arc(0, 2 * u, 20 * u, 0, TAU); c.stroke(); c.shadowBlur = 0; c.fillStyle = '#0c1116'; c.beginPath(); c.arc(0, 2 * u, 14 * u, 0, TAU); c.fill(); c.restore();
    c.save(); c.shadowColor = '#9fdcff'; c.shadowBlur = 14 * u; c.strokeStyle = 'rgba(200,236,255,.75)'; c.lineWidth = 3 * u; c.lineCap = 'round'; c.beginPath(); c.moveTo(cx + sx * (cw0 + 44 * u), H * 0.862); c.lineTo(cx + sx * (cw0 + 96 * u), H * 0.842); c.stroke(); c.restore(); }
  // frame of the manipulator's status box
  if (L.q.manip) { const q = L.q.manip, p = 9 * u; c.save(); c.transform(q.U[0] / q.w, q.U[1] / q.w, q.V[0] / q.h, q.V[1] / q.h, q.o[0], q.o[1]); rrect(c, -p, -p, q.w + p * 2, q.h + p * 2, 10 * u); c.fillStyle = 'rgba(6,10,15,.7)'; c.fill(); c.strokeStyle = 'rgba(200,225,245,.55)'; c.lineWidth = 1.4 * u; c.stroke(); c.restore(); }
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
function drawCamTag(c, w, h, st) {
  c.clearRect(0, 0, w, h); const k = h / 220;
  if (!st.camOn) { scrBase(c, w, h); c.strokeStyle = 'rgba(110,190,240,.25)'; c.lineWidth = 1; for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, (h * i) / 6); c.lineTo(w, (h * i) / 6); c.stroke(); } txt(c, '팔 카메라 대기', w / 2, h * 0.55, 16 * k, INK + '.6)', 'center'); }
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
function drawManip(c, w, h, st) { c.clearRect(0, 0, w, h); const k = h / 110, a = st.arm, key = !a.on ? 'idle' : a.first ? 'unfold' : a.phase, [say, p0] = ARM_SAY[key] || ARM_SAY.idle, p = key === 'carry' ? 0.75 + 0.25 * Math.min(1, a.t / 0.8) : key === 'aim' && a.aimed ? 0.62 : p0;
  txt(c, '로봇 팔', 4 * k, 26 * k, 21 * k, '#f2f8fc', 'left', 600); txt(c, say, 4 * k, 58 * k, 20 * k, a.aimed ? '#e3bd5f' : INK + '.85)');
  rrect(c, 2 * k, 78 * k, w - 4 * k, 9 * k, 4 * k); c.fillStyle = INK + '.2)'; c.fill(); if (p > 0) { rrect(c, 2 * k, 78 * k, (w - 4 * k) * p, 9 * k, 4 * k); c.fillStyle = a.aimed ? '#e3bd5f' : '#cfe9fb'; c.fill(); } }

export class SphereUI extends CockpitUI {
  setLayout(L, dpr) { super.setLayout(L, dpr); const cam = this.cv.cam; if (cam) Object.assign(cam.style, { filter: 'saturate(.9) contrast(1.05)', opacity: '1', borderRadius: '3px' }); }
  update(st, dt) {
    this.run('scrL', 1 / 15, dt, (c, w, h) => drawSonar(c, w, h, st));
    this.run('scrR', 1 / 3, dt, (c, w, h) => drawCamTag(c, w, h, st));
    this.run('scrC', 1 / 10, dt, (c, w, h) => drawConsole(c, w, h, st));
    this.run('hudL', 1 / 5, dt, (c, w, h) => drawReadL(c, w, h, st));
    this.run('hudR', 1 / 5, dt, (c, w, h) => drawReadR(c, w, h, st));
    this.run('comp', 1 / 20, dt, (c, w, h) => drawCompass(c, w, h, st));
    this.run('manip', 1 / 10, dt, (c, w, h) => drawManip(c, w, h, st));
  }
}
