// First-person cockpit: a porthole above an instrument console.
// The static art (cabin walls, porthole frame, console body, bezels) is painted once per resize or
// damage tier. Every instrument is its own small canvas placed with a CSS matrix transform, so it is
// drawn in flat local coordinates and redrawn on its own schedule. The camera monitor is a hole in
// the static art; main.js renders the live feed into the WebGL canvas underneath it.
import { TAU, clamp, mulberry32 } from './util.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// ---------------------------------------------------------------- helpers
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function lin(c, x0, y0, x1, y1, stops) { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([t, col]) => g.addColorStop(t, col)); return g; }
function txt(c, s, x, y, size, col, align = 'left', font = MONO, weight = 500) { c.font = `${weight} ${Math.round(size)}px ${font}`; c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); }
function screw(c, x, y, r) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, '#9aa6b0'); g.addColorStop(1, '#262d34');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.2); c.lineTo(x + r * 0.6, y + r * 0.2); c.stroke();
}
// a quad is a parallelogram: origin o, width edge U, height edge V; w/h are its local pixel size
function Q(o, U, V) { return { o, U, V, w: Math.max(1, Math.round(Math.hypot(U[0], U[1]))), h: Math.max(1, Math.round(Math.hypot(V[0], V[1]))) }; }
export const quadMatrix = (q) => [q.U[0] / q.w, q.U[1] / q.w, q.V[0] / q.h, q.V[1] / q.h, q.o[0], q.o[1]];
function inQuad(c, pr, q, fn) { const m = quadMatrix(q); c.save(); c.setTransform(pr * m[0], pr * m[1], pr * m[2], pr * m[3], pr * m[4], pr * m[5]); fn(q.w, q.h); c.restore(); }

export const headingDeg = (yaw) => ((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI + 360) % 360;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const headingLabel = (yaw) => { const d = headingDeg(yaw); return `${DIRS[Math.round(d / 45) % 8]} ${String(Math.round(d) % 360).padStart(3, '0')}°`; };

// ---------------------------------------------------------------- layout
// The whole screen is the viewing glass, held by a slim canopy frame; a low console runs along the
// bottom. Console geometry is authored in design units (x relative to the screen centre, y on a
// 0..1000 scale where 1000 is the bottom edge) and scales uniformly by k, anchored to the bottom.
export function cockpitLayout(W, H, touch) {
  const full = H >= 560 && W >= 820 && W > H * 1.05;
  const cx = W / 2, u = H / 1000;
  const k = full ? Math.min(u * 0.95, (W / 2 - 14) / 730) : Math.min(u * 1.25, (W / 2 - 12) / 730);
  const off = !full && touch ? -120 : 0; // phones: leave the bottom-right corner free for the touch buttons
  const X = (x) => cx + (x + off) * k, Y = (y) => H - (1000 - y) * k;
  const q = (ox, oy, ux, uy, vx, vy) => Q([X(ox), Y(oy)], [ux * k, uy * k], [vx * k, vy * k]);
  const L = { W, H, k, full, touch, cx, X, Y, q: {}, gauges: [] };
  L.fw = Math.max(7, 13 * k);
  L.deskTop = Y(812); L.hoodTop = Y(770);
  L.win = { x: L.fw, y: L.fw, w: W - L.fw * 2, h: L.deskTop - L.fw + 40 * k, r: Math.max(16, 38 * k) };
  L.ppY = (L.fw + L.hoodTop) / 2;
  L.glass = { x0: L.fw, y0: L.fw, x1: W - L.fw, y1: L.hoodTop };
  L.view = { x: 0, y: 0, w: W, h: Math.min(H, Math.ceil(L.deskTop + 2)) }; // screen area the 3D view has to cover
  L.q.scrC = q(-236, 788, 472, 0, 0, 158);
  L.q.annun = q(-236, 956, 472, 0, 0, 22);
  L.q.scrL = q(-716, 800, 286, -18, 12, 160);
  if (!touch) L.q.scrR = q(430, 782, 286, 18, -12, 160);
  if (full) { L.gauges.push({ x: X(-346), y: Y(890), r: 54 * k, kind: 'depth' }); if (!touch) L.gauges.push({ x: X(346), y: Y(890), r: 54 * k, kind: 'speed' }); }
  return L;
}

// ---------------------------------------------------------------- static art
export function drawCockpit(cv, L, pr, tier) {
  const { W, H } = L;
  cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
  const c = cv.getContext('2d'); c.setTransform(pr, 0, 0, pr, 0, 0); c.clearRect(0, 0, W, H);
  const rng = mulberry32(99 + tier);
  canopy(c, L, rng, tier);
  consoleBody(c, L, pr);
}

function canopy(c, L, rng, tier) {
  const { W, H, k, win, fw } = L, g0 = L.hoodTop;
  // frame: paint the metal, then cut the glass out of it
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, '#2c3640'], [0.6, '#1b2229'], [1, '#0e1216']]); c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.05; c.fillStyle = '#ffffff'; for (let i = 0; i < (W + H) * 1.5; i++) { const t = rng(); const x = t < 0.5 ? rng() * W : rng() < 0.5 ? rng() * fw : W - rng() * fw, y = t < 0.5 ? rng() * fw : rng() * H; c.fillRect(x, y, 1, 1); } c.globalAlpha = 1;
  c.save(); c.globalCompositeOperation = 'destination-out'; rr(c, win.x, win.y, win.w, win.h, win.r); c.fill(); c.restore();
  // glass
  c.save(); rr(c, win.x, win.y, win.w, win.h, win.r); c.clip();
  const cx = W / 2, cy = L.ppY, rg = c.createRadialGradient(cx, cy, Math.min(W, g0) * 0.42, cx, cy, Math.hypot(W / 2, g0 / 2) * 1.08);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,12,18,.55)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.fillStyle = lin(c, 0, 0, 0, H * 0.14, [[0, 'rgba(200,235,255,.06)'], [1, 'rgba(200,235,255,0)']]); c.fillRect(0, 0, W, H * 0.14);
  c.fillStyle = lin(c, 0, g0, 0, g0 - H * 0.14, [[0, 'rgba(80,160,220,.09)'], [1, 'rgba(80,160,220,0)']]); c.fillRect(0, g0 - H * 0.14, W, H * 0.14);
  // reflections: two broad diagonal bands and a thin one
  for (const [x0, w0, a] of [[0.08, 0.1, 0.035], [0.2, 0.025, 0.045], [0.7, 0.07, 0.025]]) {
    c.fillStyle = lin(c, W * x0, 0, W * (x0 + w0), 0, [[0, 'rgba(210,240,255,0)'], [0.5, `rgba(210,240,255,${a})`], [1, 'rgba(210,240,255,0)']]);
    c.beginPath(); c.moveTo(W * x0 + H * 0.3, 0); c.lineTo(W * (x0 + w0) + H * 0.3, 0); c.lineTo(W * (x0 + w0) - H * 0.12, g0); c.lineTo(W * x0 - H * 0.12, g0); c.closePath(); c.fill();
  }
  for (const [x, y] of [[win.x, win.y], [win.x + win.w, win.y]]) { const g = c.createRadialGradient(x, y, 0, x, y, H * 0.3); g.addColorStop(0, 'rgba(210,240,255,.07)'); g.addColorStop(1, 'rgba(210,240,255,0)'); c.fillStyle = g; c.fillRect(x - H * 0.3, y - H * 0.3, H * 0.6, H * 0.6); }
  // smudges and hairline scratches
  for (let i = 0; i < 6; i++) { const x = rng() * W, y = rng() * g0, r = (40 + rng() * 90) * k; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(220,235,245,.025)'); g.addColorStop(1, 'rgba(220,235,245,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
  c.strokeStyle = 'rgba(230,245,255,.06)'; c.lineWidth = 0.8; for (let i = 0; i < 10; i++) { const x = rng() * W, y = rng() * g0, a = rng() * Math.PI, l = (20 + rng() * 60) * k; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.3) * l * 0.5, y + Math.sin(a + 0.3) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  if (tier > 0) {
    const n = tier === 1 ? 2 : 5;
    for (let i = 0; i < n; i++) {
      const edge = (rng() * 3) | 0, x = edge === 0 ? win.x : edge === 1 ? win.x + win.w : win.x + rng() * win.w, y = edge === 2 ? win.y : win.y + rng() * g0 * 0.85;
      const a = Math.atan2(cy - y, cx - x) + (rng() - 0.5) * 1.2;
      const draw = (x, y, a, len, depth) => { const pts = [[x, y]]; for (let s = 0; s < 7; s++) { a += (rng() - 0.5) * 0.7; x += (Math.cos(a) * len) / 7; y += (Math.sin(a) * len) / 7; pts.push([x, y]); }
        for (const [col, w, dx] of [['rgba(0,0,0,.5)', 2.2, 1], ['rgba(230,245,255,.75)', 1.1, 0]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach(([px, py], j) => (j ? c.lineTo(px + dx, py + dx) : c.moveTo(px + dx, py + dx))); c.stroke(); }
        if (depth > 0) for (let b = 0; b < 2; b++) { const p = pts[2 + ((rng() * 4) | 0)]; draw(p[0], p[1], a + (rng() - 0.5) * 2, len * 0.5, depth - 1); } };
      draw(x, y, a, Math.min(W, H) * (0.18 + rng() * 0.2), 2);
    }
  }
  c.restore();
  // gasket, glass edge highlight and frame bolts
  c.lineWidth = Math.max(2.5, 5 * k); c.strokeStyle = '#040607'; rr(c, win.x, win.y, win.w, win.h, win.r); c.stroke();
  c.lineWidth = 1; c.strokeStyle = 'rgba(170,220,245,.22)'; rr(c, win.x + 3, win.y + 3, win.w - 6, win.h - 6, win.r - 3); c.stroke();
  c.strokeStyle = 'rgba(210,230,245,.16)'; c.beginPath(); c.moveTo(0, 0.5); c.lineTo(W, 0.5); c.stroke();
  const br = Math.max(1.8, 3 * k), step = Math.max(90, 150 * k);
  for (let x = win.r + step / 2; x < W - win.r; x += step) screw(c, x, fw / 2, br);
  for (let y = win.r + step / 2; y < L.deskTop - 10; y += step) { screw(c, fw / 2, y, br); screw(c, W - fw / 2, y, br); }
}

function consoleBody(c, L, pr) {
  const { W, H, k, X, Y, full } = L;
  // desk: rounded lip across the width and the vertical face below it
  const yb = L.deskTop, lip = 12 * k;
  c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 26 * k; c.shadowOffsetY = -4 * k;
  c.fillStyle = lin(c, 0, yb, 0, H, [[0, '#36414c'], [Math.min(0.9, lip / (H - yb)), '#1d252c'], [0.5, '#141a20'], [1, '#07090b']]); c.fillRect(0, yb, W, H - yb); c.restore();
  c.fillStyle = 'rgba(190,215,235,.2)'; c.fillRect(0, yb, W, 1);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.5;
  for (const x of [-420, 420, -760, 760]) { const px = X(x); if (px < 0 || px > W) continue; c.beginPath(); c.moveTo(px, yb + lip); c.lineTo(px, H); c.stroke(); }
  for (let x = -900; x <= 900; x += 150) { const px = X(x); if (px > 8 && px < W - 8) screw(c, px, yb + lip + 7 * k, Math.max(1.8, 2.6 * k)); }
  // centre hood carrying the nav screen
  const ht = 770, hw0 = 262, hw1 = 280;
  const hood = () => { c.beginPath(); c.moveTo(X(-hw1), Y(1000)); c.lineTo(X(-hw0), Y(ht + 14)); c.quadraticCurveTo(X(-hw0), Y(ht), X(-hw0 + 16), Y(ht)); c.lineTo(X(hw0 - 16), Y(ht)); c.quadraticCurveTo(X(hw0), Y(ht), X(hw0), Y(ht + 14)); c.lineTo(X(hw1), Y(1000)); c.closePath(); };
  c.save(); c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 22 * k; c.shadowOffsetY = 6 * k; hood();
  c.fillStyle = lin(c, 0, Y(ht), 0, H, [[0, '#303a44'], [0.2, '#232b33'], [1, '#12171c']]); c.fill(); c.restore();
  hood(); c.save(); c.clip(); c.fillStyle = lin(c, X(-hw1), 0, X(hw1), 0, [[0, 'rgba(255,255,255,.05)'], [0.1, 'rgba(0,0,0,0)'], [0.9, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.3)']]); c.fillRect(0, 0, W, H); c.restore();
  c.strokeStyle = 'rgba(190,215,235,.3)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(-hw0), Y(ht + 14)); c.quadraticCurveTo(X(-hw0), Y(ht), X(-hw0 + 16), Y(ht)); c.lineTo(X(hw0 - 16), Y(ht)); c.quadraticCurveTo(X(hw0), Y(ht), X(hw0), Y(ht + 14)); c.stroke();
  // gauge bezels
  for (const g of L.gauges) {
    const R = g.r + 8 * k;
    c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 10 * k; c.shadowOffsetY = 3 * k;
    c.fillStyle = lin(c, g.x - R, g.y - R, g.x + R, g.y + R, [[0, '#7a8793'], [0.45, '#35404a'], [1, '#12171b']]); c.beginPath(); c.arc(g.x, g.y, R, 0, TAU); c.fill(); c.restore();
    c.fillStyle = '#020304'; c.beginPath(); c.arc(g.x, g.y, g.r + 1.5, 0, TAU); c.fill();
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; screw(c, g.x + Math.cos(a) * (g.r + 4 * k), g.y + Math.sin(a) * (g.r + 4 * k), Math.max(1.4, 2.1 * k)); }
  }
  // screen housings
  const housing = (q, b, label) => {
    inQuad(c, pr, q, (w, h) => {
      c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 18 * k; c.shadowOffsetY = 6 * k;
      rr(c, -b, -b, w + b * 2, h + b * 2, 10 * k); c.fillStyle = lin(c, 0, -b, 0, h + b, [[0, '#333e48'], [0.1, '#232b33'], [1, '#12171c']]); c.fill(); c.restore();
      c.strokeStyle = 'rgba(190,215,235,.22)'; c.lineWidth = 1; rr(c, -b + 0.5, -b + 0.5, w + b * 2 - 1, h + b * 2 - 1, 10 * k); c.stroke();
      rr(c, -3 * k, -3 * k, w + 6 * k, h + 6 * k, 4 * k); c.fillStyle = '#020304'; c.fill();
      for (const [sx, sy] of [[-b * 0.55, -b * 0.55], [w + b * 0.55, -b * 0.55], [-b * 0.55, h + b * 0.55], [w + b * 0.55, h + b * 0.55]]) screw(c, sx, sy, Math.max(1.4, 2.3 * k));
      if (label) txt(c, label, w / 2, h + b * 0.74, Math.max(7, 8 * k), 'rgba(200,220,235,.38)', 'center', SANS, 700);
    });
  };
  housing(L.q.scrC, 14 * k, '');
  if (L.q.scrL) housing(L.q.scrL, 15 * k, 'PROXIMITY SONAR');
  if (L.q.scrR) housing(L.q.scrR, 15 * k, 'EXTERNAL CAMERA');
  // soft light spill from the screens onto the console
  c.save(); c.globalCompositeOperation = 'source-atop';
  for (const q of [L.q.scrC, L.q.scrL, L.q.scrR]) { if (!q) continue; const [x, y] = [q.o[0] + (q.U[0] + q.V[0]) / 2, q.o[1] + (q.U[1] + q.V[1]) / 2], r = q.w * 0.9;
    if (y - r > H) continue; const g = c.createRadialGradient(x, y, r * 0.2, x, y, r); g.addColorStop(0, 'rgba(70,150,220,.10)'); g.addColorStop(1, 'rgba(70,150,220,0)'); c.fillStyle = g; c.fillRect(x - r, Math.max(yb, y - r), r * 2, r * 2); }
  c.restore();
}

// ---------------------------------------------------------------- instruments
const PH = 'rgba(110,255,170,';
const LED = { g: '#4dff88', a: '#ffb43a', r: '#ff4a3a', c: '#5ad8ff' };
function screenBase(c, w, h, top, bot) { c.fillStyle = lin(c, 0, 0, 0, h, [[0, top], [1, bot]]); c.fillRect(0, 0, w, h); }
function screenGlass(c, w, h) {
  c.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.42)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = lin(c, 0, 0, w * 0.55, h, [[0, 'rgba(255,255,255,.07)'], [0.4, 'rgba(255,255,255,.015)'], [0.41, 'rgba(255,255,255,0)']]); c.fillRect(0, 0, w, h);
}
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
const blinkOn = (t, hz = 1.6) => Math.floor(t * hz * 2) % 2 === 0;

export function drawRadarScr(c, w, h, st) {
  screenBase(c, w, h, '#03140d', '#010705');
  const s = h / 218, fs = Math.max(9, 12 * s), cx = w / 2, cy = h * 0.54, R = h * 0.4, range = st.sonarRange, k = R / range;
  const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw), rx = -Math.cos(st.yaw), rz = Math.sin(st.yaw);
  const toS = (x, z) => { const dx = x - st.pos.x, dz = z - st.pos.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k]; };
  c.lineWidth = Math.max(1, s);
  c.strokeStyle = PH + '.07)'; c.beginPath(); for (let x = cx % (R / 2); x < w; x += R / 2) { c.moveTo(x, 0); c.lineTo(x, h); } for (let y = cy % (R / 2); y < h; y += R / 2) { c.moveTo(0, y); c.lineTo(w, y); } c.stroke();
  c.strokeStyle = PH + '.32)'; for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, (R * i) / 4, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
  c.strokeStyle = PH + '.5)'; c.beginPath(); for (let a = 0; a < 360; a += 10) { const t = (a * Math.PI) / 180, r0 = R * (a % 30 ? 0.95 : 0.9); c.moveTo(cx + Math.sin(t) * r0, cy - Math.cos(t) * r0); c.lineTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); } c.stroke();
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
  const sw = (st.t * 2.2) % TAU;
  if (c.createConicGradient) { const g = c.createConicGradient(sw - Math.PI / 2 - 1.1, cx, cy); g.addColorStop(0, PH + '0)'); g.addColorStop(0.175, PH + '.28)'); g.addColorStop(0.1751, PH + '0)'); c.fillStyle = g; c.fillRect(cx - R, cy - R, R * 2, R * 2); }
  const U = s * 1.1, r2 = range * range; let n = 0;
  const blip = (x, z, dy, col, r) => { r *= U; const [sx, sy] = toS(x, z); if ((sx - cx) ** 2 + (sy - cy) ** 2 > R * R) return; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = r * 2; c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fill(); c.shadowBlur = 0;
    if (Math.abs(dy) > 6) { const d = dy > 0 ? -1 : 1; c.beginPath(); c.moveTo(sx - 3 * U, sy + d * (r + 2 * U)); c.lineTo(sx + 3 * U, sy + d * (r + 2 * U)); c.lineTo(sx, sy + d * (r + 6 * U)); c.closePath(); c.fill(); } };
  for (const it of st.items) { if (it.col || it.locked) continue; const dx = it.pos.x - st.pos.x, dz = it.pos.z - st.pos.z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
    if (d2 > (range * 0.75) ** 2 && !it.known) continue; n++; blip(it.pos.x, it.pos.z, it.pos.y - st.pos.y, it.tr ? '#ffe08a' : it.known ? '#ffb070' : 'rgba(255,176,112,.65)', it.kg > 5 ? 3.6 : 2.6); }
  for (const r of st.rescues) if (!r.freed) blip(r.pos.x, r.pos.z, r.pos.y - st.pos.y, '#ff8fc8', 4);
  for (const e of st.creatures) { if (e.a < 0.5) continue; const hz = e.sp === 'shark' ? (e.state === 1 ? '#ff3b3b' : 'rgba(255,90,90,.8)') : e.sp === 'jelly' ? 'rgba(200,160,255,.85)' : e.sp === 'angler' ? 'rgba(255,130,90,.85)' : null; if (hz) blip(e.pos.x, e.pos.z, e.pos.y - st.pos.y, hz, e.sp === 'shark' ? 3.8 : 2.2); }
  c.restore();
  const mark = (p, col) => { let [sx, sy] = toS(p.x, p.z); const dx = sx - cx, dy = sy - cy, d = Math.hypot(dx, dy); if (d > R - 8 * s) { sx = cx + (dx / d) * (R - 8 * s); sy = cy + (dy / d) * (R - 8 * s); }
    c.fillStyle = col; c.save(); c.translate(sx, sy); c.rotate(Math.atan2(dy, dx) + Math.PI / 2); c.scale(U, U); c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 4); c.lineTo(-5, 4); c.closePath(); c.fill(); c.restore(); };
  if (st.target) mark(st.target, '#ffd166');
  mark(st.dock, '#6fe3ff');
  { const [nx, ny] = toS(st.pos.x, st.pos.z - range); const dx = nx - cx, dy = ny - cy, d = Math.hypot(dx, dy) || 1; txt(c, 'N', cx + (dx / d) * (R + 9 * s), cy + (dy / d) * (R + 9 * s) + fs * 0.35, fs * 0.9, PH + '.8)', 'center', SANS, 700); }
  c.fillStyle = '#e6fff0'; c.beginPath(); c.moveTo(cx, cy - 7 * U); c.lineTo(cx + 5 * U, cy + 5 * U); c.lineTo(cx, cy + 2.5 * U); c.lineTo(cx - 5 * U, cy + 5 * U); c.closePath(); c.fill();
  const m = 9 * s, top = m + fs * 0.9, bot = h - m;
  txt(c, 'SONAR', m, top, fs, PH + '.9)', 'left', MONO, 600); txt(c, `R ${range}m`, m, top + fs * 1.3, fs * 0.9, PH + '.55)');
  txt(c, headingLabel(st.yaw), w - m, top, fs, PH + '.9)', 'right', MONO, 600); txt(c, `TGT ${n}`, w - m, top + fs * 1.3, fs * 0.9, PH + '.55)', 'right');
  txt(c, st.sonarCd > 0 ? `CHG ${st.sonarCd.toFixed(1)}s` : 'PING RDY', m, bot, fs * 0.9, st.sonarCd > 0 ? 'rgba(255,190,90,.85)' : PH + '.85)');
  txt(c, `${Math.round(st.depth)}m`, w - m, bot, fs * 0.9, PH + '.55)', 'right');
  screenGlass(c, w, h);
}

let SPK = null;
function speckle() {
  if (SPK) return SPK; const cv = document.createElement('canvas'); cv.width = cv.height = 96; const c = cv.getContext('2d'), r = mulberry32(7);
  c.fillStyle = '#0b2446'; c.fillRect(0, 0, 96, 96);
  for (let i = 0; i < 1500; i++) { const v = r(); c.fillStyle = v > 0.97 ? '#9fe0ff' : v > 0.86 ? '#4a9ad8' : v > 0.6 ? '#22609e' : '#153c6e'; c.fillRect((r() * 96) | 0, (r() * 96) | 0, 1 + ((r() * 2) | 0), 1); }
  return (SPK = cv);
}
const NAV = { span: 160, top: 0 };
const niceStep = (x) => { const p = 10 ** Math.floor(Math.log10(x)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p; return 10 * p; };
export function drawNav(c, w, h, st) {
  screenBase(c, w, h, '#020812', '#061426');
  const s = h / 212, fs = Math.max(9, 12.5 * s), pad = 8 * s, scaleW = 34 * s;
  const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw), d0 = -25, d1 = st.navRange, N = 80, prof = new Array(N);
  let deep = st.depth;
  for (let i = 0; i < N; i++) { const d = d0 + ((d1 - d0) * i) / (N - 1); const v = -st.heightAt(st.pos.x + fx * d, st.pos.z + fz * d); prof[i] = v; if (d > 0 && v > deep) deep = v; }
  const span = clamp(deep - st.depth + 30, 60, 400), top = Math.max(st.depth - span * 0.42, -span * 0.25);
  NAV.span += (span - NAV.span) * 0.3; NAV.top += (top - NAV.top) * 0.35; if (Math.abs(NAV.top - top) > NAV.span * 0.4) { NAV.top = top; NAV.span = span; }
  const sp = NAV.span, tp = NAV.top, gw = w - scaleW;
  const xOf = (d) => ((d - d0) / (d1 - d0)) * gw, yOf = (dep) => ((dep - tp) / sp) * h;
  // water column grid
  c.strokeStyle = 'rgba(90,160,230,.07)'; c.lineWidth = 1; const step = niceStep(sp / 5);
  c.beginPath(); for (let v = Math.max(0, Math.ceil(tp / step) * step); v < tp + sp; v += step) { const y = yOf(v); c.moveTo(0, y); c.lineTo(gw, y); } for (let d = 0; d <= d1; d += 50) { const x = xOf(d); c.moveTo(x, 0); c.lineTo(x, h); } c.stroke();
  if (tp < 0) { c.fillStyle = 'rgba(40,70,100,.25)'; c.fillRect(0, 0, gw, yOf(0)); }
  if (tp < 2) { c.strokeStyle = 'rgba(140,210,255,.35)'; c.setLineDash([4 * s, 4 * s]); c.beginPath(); c.moveTo(0, yOf(0)); c.lineTo(gw, yOf(0)); c.stroke(); c.setLineDash([]); }
  if (st.limit > tp && st.limit < tp + sp) { const y = yOf(st.limit); c.strokeStyle = 'rgba(255,90,80,.55)'; c.setLineDash([6 * s, 4 * s]); c.beginPath(); c.moveTo(0, y); c.lineTo(gw, y); c.stroke(); c.setLineDash([]); txt(c, 'LIMIT', gw - 4 * s, y - 3 * s, fs * 0.7, 'rgba(255,110,100,.8)', 'right', MONO, 600); }
  // seabed
  c.beginPath(); c.moveTo(0, h); for (let i = 0; i < N; i++) c.lineTo(xOf(d0 + ((d1 - d0) * i) / (N - 1)), yOf(prof[i])); c.lineTo(gw, h); c.closePath();
  c.save(); c.clip(); c.fillStyle = c.createPattern(speckle(), 'repeat'); c.fillRect(0, 0, gw, h);
  c.fillStyle = lin(c, 0, 0, 0, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,4,12,.55)']]); c.fillRect(0, 0, gw, h); c.restore();
  const surf = () => { c.beginPath(); for (let i = 0; i < N; i++) { const x = xOf(d0 + ((d1 - d0) * i) / (N - 1)), y = yOf(prof[i]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } };
  c.save(); c.lineJoin = 'round'; surf(); c.strokeStyle = 'rgba(120,220,255,.22)'; c.lineWidth = 6 * s; c.stroke(); surf(); c.strokeStyle = '#8fe4ff'; c.lineWidth = 1.6 * s; c.stroke(); c.restore();
  // contacts near the sonar plane
  for (const it of st.items) { if (it.col || it.locked) continue; const dx = it.pos.x - st.pos.x, dz = it.pos.z - st.pos.z, a = dx * fx + dz * fz; if (a < d0 || a > d1) continue; if (Math.abs(dx * fz - dz * fx) > 16) continue;
    const x = xOf(a), y = yOf(-it.pos.y); if (y < 0 || y > h) continue; c.fillStyle = it.tr ? '#ffe08a' : '#ffae6b'; c.fillRect(x - 2 * s, y - 2 * s, 4 * s, 4 * s); }
  for (const e of st.creatures) { if (e.a < 0.5) continue; const dx = e.pos.x - st.pos.x, dz = e.pos.z - st.pos.z, a = dx * fx + dz * fz; if (a < d0 || a > d1 || Math.abs(dx * fz - dz * fx) > 25) continue;
    const x = xOf(a), y = yOf(-e.pos.y); c.fillStyle = e.sp === 'shark' ? '#ff6a5e' : 'rgba(170,240,255,.8)'; c.beginPath(); c.moveTo(x - 4 * s, y); c.lineTo(x + 3 * s, y - 2 * s); c.lineTo(x + 3 * s, y + 2 * s); c.closePath(); c.fill(); }
  // own position crosshair and beam reach
  const ox = xOf(0), oy = yOf(st.depth);
  c.strokeStyle = 'rgba(210,240,255,.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(ox, 0); c.lineTo(ox, h); c.moveTo(0, oy); c.lineTo(gw, oy); c.stroke();
  c.strokeStyle = '#e6f6ff'; c.lineWidth = 1.4 * s; c.strokeRect(ox - 7 * s, oy - 5 * s, 14 * s, 10 * s);
  const bx = xOf(st.beamRange); c.strokeStyle = 'rgba(255,209,102,.7)'; c.beginPath(); c.moveTo(bx, oy - 6 * s); c.lineTo(bx, oy + 6 * s); c.moveTo(ox + 8 * s, oy); c.lineTo(bx, oy); c.stroke();
  // depth scale
  c.fillStyle = 'rgba(0,8,18,.6)'; c.fillRect(gw, 0, scaleW, h); c.strokeStyle = 'rgba(160,210,240,.6)'; c.beginPath(); c.moveTo(gw + 4 * s, 0); c.lineTo(gw + 4 * s, h); c.stroke();
  for (let v = Math.max(0, Math.ceil(tp / (step / 2)) * (step / 2)); v < tp + sp; v += step / 2) { const y = yOf(v), big = Math.abs(v / step - Math.round(v / step)) < 1e-6; c.beginPath(); c.moveTo(gw + 4 * s, y); c.lineTo(gw + (big ? 11 : 8) * s, y); c.stroke(); if (big && y > fs && y < h - 4) txt(c, String(Math.round(v)), w - 3 * s, y + fs * 0.32, fs * 0.72, 'rgba(200,230,250,.8)', 'right'); }
  c.fillStyle = '#e6f6ff'; c.beginPath(); c.moveTo(gw + 3 * s, oy); c.lineTo(gw + 10 * s, oy - 4 * s); c.lineTo(gw + 10 * s, oy + 4 * s); c.closePath(); c.fill();
  // readouts
  const lab = 'rgba(150,195,225,.75)', val = '#e8f6ff', warn = '#ff6b5e', lh = fs * 1.35, y0 = pad + fs;
  const temp = 3.8 + 18.5 * Math.exp(-st.depth / 70);
  const rows = [['DEPTH', `${st.depth.toFixed(1)} m`, st.depth > st.limit ? warn : st.depth > st.limit * 0.9 ? '#ffb43a' : val], ['TEMP', `${temp.toFixed(1)} °C`, val], ['SPEED', `${st.speed.toFixed(1)} m/s`, val]];
  const small = h < 120; (small ? [rows[0], rows[2]] : rows).forEach(([a, b, col], i) => { txt(c, a, pad, y0 + i * lh, fs * 0.85, lab, 'left', MONO, 600); txt(c, b, pad + fs * 4.6, y0 + i * lh, fs, col, 'left', MONO, 600); });
  const bars = [['PWR', st.bat, `${Math.round(st.bat * 100)}%`, st.bat < 0.25], ['HULL', st.hull, `${Math.round(st.hull * 100)}%`, st.hull < 0.3], ['CARGO', Math.min(1, st.kg / st.cargo), `${Math.round(st.kg)}/${st.cargo}`, st.kg >= st.cargo * 0.92]];
  const bw = small ? 0 : Math.min(70 * s, gw * 0.16), bxr = gw - pad;
  bars.forEach(([a, f, v, bad], i) => { const y = y0 + i * lh, vx = bxr, bx1 = vx - fs * 3.9, bx0 = bx1 - bw;
    txt(c, a, bx0 - 6 * s, y, fs * 0.85, lab, 'right', MONO, 600);
    if (bw) { c.fillStyle = 'rgba(150,200,240,.18)'; c.fillRect(bx0, y - fs * 0.45, bw, 3 * s); c.fillStyle = bad ? warn : '#8fe4ff'; c.fillRect(bx0, y - fs * 0.45, bw * clamp(f, 0, 1), 3 * s); }
    txt(c, v, vx, y, fs * 0.9, bad ? warn : val, 'right', MONO, 600); });
  txt(c, `FUNDS ${fmtN(st.money)}`, pad, h - pad, fs * 0.85, '#e9c46a', 'left', MONO, 600);
  txt(c, `FWD SONAR ${d1}m`, gw - pad, h - pad, fs * 0.75, lab, 'right');
  screenGlass(c, w, h);
}

export function drawCamOverlay(c, w, h, st) {
  c.clearRect(0, 0, w, h); const s = h / 218, fs = Math.max(9, 12 * s), m = 9 * s, L = 16 * s;
  if (!st.camOn) { c.fillStyle = '#0b0e10'; c.fillRect(0, 0, w, h); for (let i = 0; i < (w * h) / 40; i++) { c.fillStyle = `rgba(200,210,215,${Math.random() * 0.35})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 1); } }
  c.fillStyle = 'rgba(0,0,0,.14)'; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.58); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)'); c.fillStyle = vg; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(235,245,250,.6)'; c.lineWidth = 1.5 * s;
  c.beginPath(); for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { c.moveTo(x, y + dy * L); c.lineTo(x, y); c.lineTo(x + dx * L, y); } c.stroke();
  c.beginPath(); c.moveTo(w / 2 - 8 * s, h / 2); c.lineTo(w / 2 + 8 * s, h / 2); c.moveTo(w / 2, h / 2 - 8 * s); c.lineTo(w / 2, h / 2 + 8 * s); c.strokeStyle = 'rgba(235,245,250,.35)'; c.stroke();
  const col = 'rgba(240,248,252,.92)', tx = m + 8 * s, ty = m + fs + 4 * s;
  txt(c, st.cam ? 'CAM 02' : 'CAM 01', tx, ty, fs, col, 'left', MONO, 600); txt(c, st.cam ? 'STERN' : 'BOW · DOWN', tx, ty + fs * 1.15, fs * 0.75, 'rgba(230,240,248,.6)');
  if (st.camOn && blinkOn(st.t, 0.8)) { c.fillStyle = '#ff3b30'; c.beginPath(); c.arc(w - tx - fs * 2.6, ty - fs * 0.35, fs * 0.33, 0, TAU); c.fill(); }
  txt(c, st.camOn ? 'REC' : 'OFF', w - tx, ty, fs, col, 'right', MONO, 600);
  const t = Math.floor(st.clock), hh = String(Math.floor(t / 3600)).padStart(2, '0'), mm = String(Math.floor(t / 60) % 60).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
  txt(c, `${hh}:${mm}:${ss}`, tx, h - m - 6 * s, fs * 0.85, col); txt(c, `${Math.round(st.depth)} m`, w - tx, h - m - 6 * s, fs * 0.85, col, 'right');
  if (!st.camOn) txt(c, 'NO SIGNAL', w / 2, h / 2 + fs * 1.8, fs * 1.1, 'rgba(240,248,252,.8)', 'center', MONO, 700);
}

export function drawAnnun(c, w, h, st) {
  c.clearRect(0, 0, w, h); const on = blinkOn(st.t, 1.2);
  const tiles = [['PWR', st.bat < 0.1 ? (on ? 'r' : '') : st.bat < 0.25 ? 'a' : ''], ['HULL', st.hull < 0.3 ? (on ? 'r' : '') : st.hull < 0.6 ? 'a' : ''],
    ['PRESS', st.depth > st.limit ? (on ? 'r' : '') : st.depth > st.limit * 0.9 ? 'a' : ''], ['CARGO', st.kg >= st.cargo * 0.92 ? 'a' : ''],
    ['BEAM', st.beam ? 'c' : ''], ['BOOST', st.boost ? 'c' : ''], ['SONAR', st.sonarCd > 0 ? '' : 'g']];
  const n = tiles.length, gap = h * 0.25, tw = (w - gap * (n - 1)) / n;
  tiles.forEach(([lab, stt], i) => { const x = i * (tw + gap), col = LED[stt];
    rr(c, x, 0, tw, h, 2); c.fillStyle = col ? col + '33' : '#0b0f12'; c.fill(); c.strokeStyle = col ? col + 'aa' : 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.stroke();
    txt(c, lab, x + tw / 2, h * 0.7, Math.min(h * 0.52, (tw - 3) / (lab.length * 0.7)), col || 'rgba(200,215,225,.32)', 'center', SANS, 700); });
}

export function drawGauge(c, S, kind, st) {
  c.clearRect(0, 0, S, S); const r = S / 2, R = r * 0.97, s = r / 64; c.save(); c.translate(r, r);
  const face = c.createRadialGradient(0, -R * 0.3, R * 0.1, 0, 0, R); face.addColorStop(0, '#0f1b20'); face.addColorStop(1, '#030607'); c.fillStyle = face; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
  const lum = 'rgba(190,255,225,', glow = '#6ff7c8', fsz = Math.max(7.5, 10 * s);
  if (kind === 'compass') {
    const hd = (headingDeg(st.yaw) * Math.PI) / 180;
    c.save(); c.rotate(-hd);
    for (let d = 0; d < 360; d += 5) { const a = (d * Math.PI) / 180, big = d % 30 === 0, r0 = R * (big ? 0.76 : d % 10 === 0 ? 0.83 : 0.87); c.strokeStyle = lum + (big ? '.95)' : '.45)'); c.lineWidth = (big ? 1.8 : 1) * s;
      c.beginPath(); c.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); c.lineTo(Math.sin(a) * R * 0.93, -Math.cos(a) * R * 0.93); c.stroke(); }
    ['N', 'E', 'S', 'W'].forEach((l, i) => { c.save(); c.rotate((i * Math.PI) / 2); txt(c, l, 0, -R * 0.52, fsz * 1.3, i === 0 ? '#ffcf5a' : lum + '.9)', 'center', SANS, 800); c.restore(); });
    c.restore();
    c.fillStyle = '#ffcf5a'; c.beginPath(); c.moveTo(0, -R * 0.93); c.lineTo(-4 * s, -R * 0.99); c.lineTo(4 * s, -R * 0.99); c.closePath(); c.fill();
    c.fillStyle = lum + '.85)'; c.beginPath(); c.moveTo(0, -10 * s); c.lineTo(6 * s, 8 * s); c.lineTo(0, 4 * s); c.lineTo(-6 * s, 8 * s); c.closePath(); c.fill();
    txt(c, String(Math.round(headingDeg(st.yaw)) % 360).padStart(3, '0'), 0, R * 0.36, fsz * 1.1, glow, 'center', MONO, 600);
    txt(c, 'HDG', 0, R * 0.58, fsz * 0.85, lum + '.5)', 'center', SANS, 700);
  } else {
    const dep = kind === 'depth';
    const hi = dep ? st.limit * 1.25 : st.vmax, major = niceStep(hi / 6), max = Math.ceil(hi / major) * major;
    const v = dep ? st.depth : st.speed, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = (x) => a0 + (a1 - a0) * clamp(x / max, 0, 1.03);
    if (dep && st.limit < max) { c.strokeStyle = 'rgba(255,80,70,.8)'; c.lineWidth = 5 * s; c.beginPath(); c.arc(0, 0, R * 0.86, A(st.limit), A(max)); c.stroke(); }
    for (let x = 0; x <= max + 1e-6; x += major / 5) { const a = A(x), big = Math.abs(x / major - Math.round(x / major)) < 1e-6, r0 = R * (big ? 0.76 : 0.84);
      c.strokeStyle = lum + (big ? '.95)' : '.45)'); c.lineWidth = (big ? 1.8 : 1) * s; c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92); c.stroke(); }
    for (let x = 0; x <= max + 1e-6; x += major) { const a = A(x); txt(c, String(x), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6 + fsz * 0.35, fsz, lum + '.9)', 'center', MONO, 600); }
    txt(c, dep ? 'DEPTH' : 'SPEED', 0, R * 0.36, fsz * 0.9, lum + '.75)', 'center', SANS, 700);
    txt(c, dep ? `${Math.round(v)} m` : `${v.toFixed(1)} m/s`, 0, R * 0.62, fsz, glow, 'center', MONO, 600);
    c.save(); c.rotate(A(v)); c.shadowColor = glow; c.shadowBlur = 6 * s; c.fillStyle = glow;
    c.beginPath(); c.moveTo(-R * 0.14, -2.4 * s); c.lineTo(R * 0.8, -0.8 * s); c.lineTo(R * 0.85, 0); c.lineTo(R * 0.8, 0.8 * s); c.lineTo(-R * 0.14, 2.4 * s); c.closePath(); c.fill(); c.restore();
    c.fillStyle = '#1d262c'; c.beginPath(); c.arc(0, 0, 6 * s, 0, TAU); c.fill(); c.strokeStyle = 'rgba(190,255,225,.4)'; c.lineWidth = 1; c.stroke();
  }
  c.fillStyle = lin(c, 0, -R, 0, 0, [[0, 'rgba(255,255,255,.1)'], [1, 'rgba(255,255,255,0)']]); c.beginPath(); c.ellipse(0, -R * 0.42, R * 0.82, R * 0.5, 0, Math.PI, TAU); c.fill();
  c.restore();
}

// ---------------------------------------------------------------- instrument manager
export class CockpitUI {
  constructor(root) { this.root = root; this.cv = {}; this.acc = {}; this.sig = {}; this.L = null; this.dpr = 1; }
  setLayout(L, dpr) {
    this.L = L; this.dpr = dpr; const want = {};
    for (const [id, q] of Object.entries(L.q)) if (q) want[id] = q;
    if (L.q.scrR) want.cam = L.q.scrR;
    L.gauges.forEach((g, i) => { want['g' + i] = Q([g.x - g.r, g.y - g.r], [g.r * 2, 0], [0, g.r * 2]); });
    for (const id of Object.keys(this.cv)) if (!want[id]) { this.cv[id].remove(); delete this.cv[id]; }
    for (const [id, q] of Object.entries(want)) {
      let el = this.cv[id]; if (!el) { el = document.createElement('canvas'); el.dataset.id = id; this.root.appendChild(el); this.cv[id] = el; }
      el.width = Math.max(1, Math.round(q.w * dpr)); el.height = Math.max(1, Math.round(q.h * dpr)); el.style.width = q.w + 'px'; el.style.height = q.h + 'px';
      el.style.transform = `matrix(${quadMatrix(q).map((v) => +v.toFixed(5)).join(',')})`; el.style.zIndex = id === 'cam' ? 0 : 1; el._q = q;
      if (id === 'cam') el.style.filter = 'grayscale(.55) contrast(1.2) brightness(.95)';
    }
    this.acc = {}; this.sig = {};
  }
  feed(src, sw, sh) { const el = this.cv.cam; if (!el) return; const c = this.ctx('cam'); c.drawImage(src, 0, src.height - sh, sw, sh, 0, 0, el._q.w, el._q.h); }
  ctx(id) { const el = this.cv[id]; const c = el.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); return c; }
  run(id, every, dt, fn) { if (!this.cv[id]) return; this.acc[id] = (this.acc[id] ?? every) + dt; if (this.acc[id] < every) return; this.acc[id] = 0; const q = this.cv[id]._q; fn(this.ctx(id), q.w, q.h); }
  once(id, sig, fn) { if (!this.cv[id] || this.sig[id] === sig) return; this.sig[id] = sig; const q = this.cv[id]._q; fn(this.ctx(id), q.w, q.h); }
  update(st, dt) {
    this.run('scrL', 1 / 20, dt, (c, w, h) => drawRadarScr(c, w, h, st));
    this.run('scrC', 1 / 12, dt, (c, w, h) => drawNav(c, w, h, st));
    this.run('scrR', 1 / 4, dt, (c, w, h) => drawCamOverlay(c, w, h, st));
    this.L.gauges.forEach((g, i) => this.run('g' + i, 1 / 30, dt, (c, w) => drawGauge(c, w, g.kind, st)));
    const bl = blinkOn(st.t, 1.2) ? 1 : 0;
    this.once('annun', [st.bat < 0.1, st.bat < 0.25, st.hull < 0.3, st.hull < 0.6, st.depth > st.limit, st.depth > st.limit * 0.9, st.kg >= st.cargo * 0.92, st.beam, st.boost, st.sonarCd > 0, bl].join(), (c, w, h) => drawAnnun(c, w, h, st));
  }
}
