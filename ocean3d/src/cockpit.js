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
function rrSub(c, x, y, w, h, r) { // adds a rounded rect sub-path without resetting (for even-odd rings)
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function lin(c, x0, y0, x1, y1, stops) { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([t, col]) => g.addColorStop(t, col)); return g; }
function txt(c, s, x, y, size, col, align = 'left', font = MONO, weight = 500) { c.font = `${weight} ${Math.round(size)}px ${font}`; c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); }
function perimeter(x, y, w, h, r, step) { // points along a rounded-rect perimeter, ~step px apart
  const pts = [], segs = [];
  const straight = (x0, y0, x1, y1) => segs.push((t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.hypot(x1 - x0, y1 - y0)]);
  const arc = (cx, cy, a0) => segs.push((t) => [cx + Math.cos(a0 + t * Math.PI / 2) * r, cy + Math.sin(a0 + t * Math.PI / 2) * r, r * Math.PI / 2]);
  straight(x + r, y, x + w - r, y); arc(x + w - r, y + r, -Math.PI / 2); straight(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
  straight(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, Math.PI / 2); straight(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI);
  for (const s of segs) { const len = s(0)[2]; const n = Math.max(1, Math.round(len / step)); for (let i = 0; i < n; i++) { const p = s(i / n); pts.push([p[0], p[1]]); } }
  return pts;
}
function screw(c, x, y, r) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, '#9aa6b0'); g.addColorStop(1, '#262d34');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.2); c.lineTo(x + r * 0.6, y + r * 0.2); c.stroke();
}
function bolt(c, x, y, r) {
  const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r * 1.1); g.addColorStop(0, '#a3afb9'); g.addColorStop(0.6, '#4b5761'); g.addColorStop(1, '#1b2228');
  c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.arc(x + r * 0.2, y + r * 0.3, r * 1.15, 0, TAU); c.fill();
  c.fillStyle = g; c.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.stroke();
}
// a quad is a parallelogram: origin o, width edge U, height edge V; w/h are its local pixel size
function Q(o, U, V) { return { o, U, V, w: Math.max(1, Math.round(Math.hypot(U[0], U[1]))), h: Math.max(1, Math.round(Math.hypot(V[0], V[1]))) }; }
export const quadMatrix = (q) => [q.U[0] / q.w, q.U[1] / q.w, q.V[0] / q.h, q.V[1] / q.h, q.o[0], q.o[1]];
export const quadCorners = (q) => [[q.o[0], q.o[1]], [q.o[0] + q.U[0], q.o[1] + q.U[1]], [q.o[0] + q.U[0] + q.V[0], q.o[1] + q.U[1] + q.V[1]], [q.o[0] + q.V[0], q.o[1] + q.V[1]]];
function inQuad(c, pr, q, fn) { const m = quadMatrix(q); c.save(); c.setTransform(pr * m[0], pr * m[1], pr * m[2], pr * m[3], pr * m[4], pr * m[5]); fn(q.w, q.h); c.restore(); }

export const headingDeg = (yaw) => ((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI + 360) % 360;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const headingLabel = (yaw) => { const d = headingDeg(yaw); return `${DIRS[Math.round(d / 45) % 8]} ${String(Math.round(d) % 360).padStart(3, '0')}°`; };

// ---------------------------------------------------------------- layout
// Console geometry is authored in design units: x relative to the screen centre, y on a 0..1000
// scale where 1000 is the bottom edge. It scales uniformly by k and stays anchored to the bottom, so
// narrow screens get a smaller console and a taller porthole rather than a squashed one.
export function cockpitLayout(W, H, touch) {
  const full = H >= 560 && W >= 820 && W > H * 1.05;
  const cx = W / 2;
  const k = full ? Math.min(H / 1000, (W / 2 - 14) / 720) : Math.min((H / 1000) * 1.15, (W / 2 - 12) / 660);
  const off = !full && touch ? -90 : 0; // phones: leave the bottom-right corner free for the touch buttons
  const X = (x) => cx + (x + off) * k, Y = (y) => H - (1000 - y) * k;
  const q = (ox, oy, ux, uy, vx, vy) => Q([X(ox), Y(oy)], [ux * k, uy * k], [vx * k, vy * k]);
  const L = { W, H, k, full, touch, cx, X, Y, q: {}, gauges: [] };
  L.ft = Math.max(16, 44 * k);
  L.wall = Math.max(W * 0.065, 56 * k);
  const wx = L.wall + L.ft, wb = Y(full ? 640 : 722);
  L.win = { x: wx, y: -H * 0.5, w: W - wx * 2, h: wb + H * 0.5, r: (full ? 300 : 230) * k };
  L.hoodTop = Y(full ? 560 : 700);
  L.ppY = L.hoodTop * 0.52;
  L.glass = { x0: wx + 6, y0: 6, x1: W - wx - 6, y1: L.hoodTop - 6 };
  if (full) {
    L.q.scrC = q(-300, 598, 600, 0, 0, 212);
    L.q.annun = q(-300, 826, 600, 0, 0, 22);
    const sh = touch ? 186 : 200;
    L.q.scrL = q(-704, 606, 322, -26, 20, sh);
    L.q.scrR = q(382, 580, 322, 26, -20, sh);
    ['depth', 'compass', 'speed'].forEach((kind, i) => L.gauges.push({ x: X((i - 1) * 196), y: Y(930), r: 64 * k, kind }));
    L.q.btn = q(-716, 880, 170, 0, 0, 94);
    if (!touch) { L.q.bal = q(560, 880, 156, 0, 0, 94); L.q.stickL = q(-620, 800, 280, 0, 0, 214); L.q.stickR = q(340, 800, 280, 0, 0, 214); }
    if (L.wall >= 64) { const lw = Math.min(84, L.wall - 18); L.q.lcd = Q([(L.wall - lw) / 2, H * 0.2], [lw, 0], [0, lw * 1.25]); }
  } else {
    L.q.scrC = q(-265, 728, 530, 0, 0, 188);
    L.q.annun = q(-265, 932, 530, 0, 0, 24);
    L.q.scrL = q(-640, 758, 300, -20, 12, 196);
    if (!touch) L.q.scrR = q(340, 738, 300, 20, -12, 196);
  }
  return L;
}

// ---------------------------------------------------------------- static art
export function drawCockpit(cv, L, pr, tier) {
  const { W, H } = L;
  cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
  const c = cv.getContext('2d'); c.setTransform(pr, 0, 0, pr, 0, 0); c.clearRect(0, 0, W, H);
  const rng = mulberry32(99 + tier);
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, '#1b232b'], [0.55, '#11171d'], [1, '#07090c']]); c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.035; c.fillStyle = '#ffffff'; for (let i = 0; i < (W * H) / 900; i++) c.fillRect(rng() * W, rng() * H, 1, 1); c.globalAlpha = 1;
  sideWalls(c, L, rng);
  c.save(); c.globalCompositeOperation = 'destination-out'; rr(c, L.win.x, L.win.y, L.win.w, L.win.h, L.win.r); c.fill(); c.restore();
  glassFx(c, L, rng, tier);
  frame(c, L);
  consoleBody(c, L, pr);
}

function sideWalls(c, L, rng) {
  const { W, H, k, wall } = L;
  for (const side of [-1, 1]) {
    c.save(); if (side > 0) { c.translate(W, 0); c.scale(-1, 1); }
    // vertical pillar with seams and rivets
    c.fillStyle = lin(c, 0, 0, wall, 0, [[0, '#0b0f13'], [0.6, '#1a2229'], [1, '#232c35']]); c.fillRect(0, 0, wall, H);
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1.5;
    for (let y = H * 0.12; y < H; y += H * 0.24) { c.beginPath(); c.moveTo(0, y); c.lineTo(wall, y); c.stroke(); for (const x of [wall * 0.3, wall * 0.75]) screw(c, x, y + 7 * k, Math.max(2, 3.2 * k)); }
    // conduit pipe
    const px = wall * 0.16, pw = Math.max(5, 12 * k);
    c.fillStyle = lin(c, px - pw / 2, 0, px + pw / 2, 0, [[0, '#0a0d10'], [0.35, '#44505b'], [0.55, '#2a333c'], [1, '#07090b']]); c.fillRect(px - pw / 2, 0, pw, H);
    for (let y = H * 0.08; y < H; y += H * 0.18) { c.fillStyle = '#20282f'; c.fillRect(px - pw * 0.8, y, pw * 1.6, pw * 0.55); c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(px - pw * 0.8, y, pw * 1.6, 1); }
    c.restore();
  }
  // right wall: a small pressure dial and two toggles (static decoration)
  if (wall >= 48) {
    const x = W - wall * 0.55, y = H * 0.3, r = Math.min(wall * 0.34, 34 * k + 8);
    c.fillStyle = lin(c, x - r, y - r, x + r, y + r, [[0, '#6c7883'], [1, '#161c21']]); c.beginPath(); c.arc(x, y, r + 4, 0, TAU); c.fill();
    c.fillStyle = '#05090a'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(190,255,225,.55)'; c.lineWidth = 1; for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5; c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72); c.lineTo(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88); c.stroke(); }
    c.strokeStyle = '#6ff7c8'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(-0.6) * r * 0.78, y + Math.sin(-0.6) * r * 0.78); c.stroke();
    txt(c, 'O₂', x, y + r * 0.55, Math.max(8, r * 0.32), 'rgba(190,255,225,.6)', 'center', SANS, 700);
  }
}

function glassFx(c, L, rng, tier) {
  const { W, H, win } = L;
  c.save(); rr(c, win.x, win.y, win.w, win.h, win.r); c.clip();
  const cy = L.ppY, rg = c.createRadialGradient(W / 2, cy, Math.min(win.w, L.hoodTop) * 0.45, W / 2, cy, Math.hypot(win.w, L.hoodTop) * 0.62);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,8,14,.6)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  for (const [x0, w0, a] of [[0.12, 0.07, 0.05], [0.22, 0.025, 0.045], [0.74, 0.05, 0.03]]) {
    c.fillStyle = lin(c, W * x0, 0, W * (x0 + w0), 0, [[0, 'rgba(210,240,255,0)'], [0.5, `rgba(210,240,255,${a})`], [1, 'rgba(210,240,255,0)']]);
    const yb = win.y + win.h; c.beginPath(); c.moveTo(W * x0 + H * 0.25, 0); c.lineTo(W * (x0 + w0) + H * 0.25, 0); c.lineTo(W * (x0 + w0) - H * 0.1, yb); c.lineTo(W * x0 - H * 0.1, yb); c.closePath(); c.fill();
  }
  if (tier > 0) {
    const n = tier === 1 ? 2 : 5, yb = L.hoodTop;
    for (let i = 0; i < n; i++) {
      const edge = (rng() * 3) | 0; const x = edge === 0 ? win.x : edge === 1 ? win.x + win.w : win.x + rng() * win.w, y = edge === 2 ? 0 : rng() * yb * 0.9;
      const a = Math.atan2(cy - y, W / 2 - x) + (rng() - 0.5) * 1.2;
      const draw = (x, y, a, len, depth) => { const pts = [[x, y]]; for (let s = 0; s < 7; s++) { a += (rng() - 0.5) * 0.7; x += (Math.cos(a) * len) / 7; y += (Math.sin(a) * len) / 7; pts.push([x, y]); }
        for (const [col, w, dx] of [['rgba(0,0,0,.5)', 2.2, 1], ['rgba(230,245,255,.75)', 1.1, 0]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach(([px, py], j) => (j ? c.lineTo(px + dx, py + dx) : c.moveTo(px + dx, py + dx))); c.stroke(); }
        if (depth > 0) for (let b = 0; b < 2; b++) { const p = pts[2 + ((rng() * 4) | 0)]; draw(p[0], p[1], a + (rng() - 0.5) * 2, len * 0.5, depth - 1); } };
      draw(x, y, a, Math.min(W, H) * (0.18 + rng() * 0.2), 2);
    }
  }
  c.restore();
}

function frame(c, L) {
  const { win, ft, k } = L, o = { x: win.x - ft, y: win.y - ft, w: win.w + ft * 2, h: win.h + ft * 2, r: win.r + ft };
  c.save();
  c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 24 * k; c.shadowOffsetY = 6 * k;
  c.beginPath(); rrSub(c, o.x, o.y, o.w, o.h, o.r); rrSub(c, win.x, win.y, win.w, win.h, win.r);
  c.fillStyle = lin(c, 0, 0, 0, win.y + win.h + ft, [[0, '#46525e'], [0.55, '#2c3640'], [0.85, '#222a32'], [1, '#161c21']]); c.fill('evenodd');
  c.restore();
  c.save(); c.beginPath(); rrSub(c, o.x, o.y, o.w, o.h, o.r); rrSub(c, win.x, win.y, win.w, win.h, win.r); c.clip('evenodd');
  // side shading so the ring reads as rounded metal
  c.fillStyle = lin(c, o.x, 0, o.x + o.w, 0, [[0, 'rgba(255,255,255,.07)'], [0.08, 'rgba(0,0,0,0)'], [0.92, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(o.x, o.y, o.w, o.h);
  // raised flange step
  const m = ft * 0.46; c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(0,0,0,.55)'; rr(c, win.x - m, win.y - m, win.w + m * 2, win.h + m * 2, win.r + m); c.stroke();
  c.strokeStyle = 'rgba(200,225,240,.13)'; rr(c, win.x - m - 1.5, win.y - m - 1.5, win.w + m * 2 + 3, win.h + m * 2 + 3, win.r + m + 1.5); c.stroke();
  c.restore();
  // rubber gasket + glass edge
  c.lineWidth = Math.max(3, 7 * k); c.strokeStyle = '#040607'; rr(c, win.x, win.y, win.w, win.h, win.r); c.stroke();
  c.lineWidth = 1.2; c.strokeStyle = 'rgba(170,220,245,.25)'; rr(c, win.x + 3 * k + 1, win.y + 3 * k + 1, win.w - 6 * k - 2, win.h - 6 * k - 2, win.r - 3 * k); c.stroke();
  c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.7)'; rr(c, o.x, o.y, o.w, o.h, o.r); c.stroke();
  const bm = ft * 0.73;
  for (const [px, py] of perimeter(win.x - bm, win.y - bm, win.w + bm * 2, win.h + bm * 2, win.r + bm, Math.max(40, 66 * k))) if (py > 2 && py < L.H - 2) bolt(c, px, py, Math.max(3, 6.5 * k));
}

function consoleBody(c, L, pr) {
  const { W, H, k, X, Y, full } = L;
  // desk: a rounded lip across the width and the vertical face below it
  const yb = Y(full ? 668 : 752), lip = 14 * k;
  c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 30 * k; c.shadowOffsetY = -4 * k;
  c.fillStyle = lin(c, 0, yb, 0, H, [[0, '#343f4a'], [lip / (H - yb), '#1c242b'], [0.35, '#141a20'], [1, '#07090b']]); c.fillRect(0, yb, W, H - yb); c.restore();
  c.fillStyle = 'rgba(190,215,235,.18)'; c.fillRect(0, yb, W, 1);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.5;
  for (const x of full ? [-400, 400, -740, 740] : [-330, 330]) { const px = X(x); if (px < 0 || px > W) continue; c.beginPath(); c.moveTo(px, yb + lip); c.lineTo(px, H); c.stroke(); }
  for (let x = -900; x <= 900; x += 150) { const px = X(x); if (px > 8 && px < W - 8) screw(c, px, yb + lip + 8 * k, Math.max(2, 3 * k)); }
  // centre hood
  const ht = full ? 560 : 700, hb = full ? 862 : 1000, hw0 = full ? 338 : 292, hw1 = full ? 352 : 316;
  const hood = () => { c.beginPath(); c.moveTo(X(-hw1), Y(hb)); c.lineTo(X(-hw0), Y(ht + 18)); c.quadraticCurveTo(X(-hw0), Y(ht), X(-hw0 + 20), Y(ht)); c.lineTo(X(hw0 - 20), Y(ht)); c.quadraticCurveTo(X(hw0), Y(ht), X(hw0), Y(ht + 18)); c.lineTo(X(hw1), Y(hb)); c.closePath(); };
  c.save(); c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 26 * k; c.shadowOffsetY = 8 * k; hood();
  c.fillStyle = lin(c, 0, Y(ht), 0, Y(hb), [[0, '#2f3943'], [0.2, '#232b33'], [1, '#161b21']]); c.fill(); c.restore();
  hood(); c.save(); c.clip(); c.fillStyle = lin(c, X(-hw1), 0, X(hw1), 0, [[0, 'rgba(255,255,255,.05)'], [0.1, 'rgba(0,0,0,0)'], [0.9, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.3)']]); c.fillRect(0, 0, W, H); c.restore();
  c.strokeStyle = 'rgba(190,215,235,.3)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(-hw0), Y(ht + 18)); c.quadraticCurveTo(X(-hw0), Y(ht), X(-hw0 + 20), Y(ht)); c.lineTo(X(hw0 - 20), Y(ht)); c.quadraticCurveTo(X(hw0), Y(ht), X(hw0), Y(ht + 18)); c.stroke();
  // gauge plate
  if (full) {
    const gp = () => { c.beginPath(); c.moveTo(X(-372), Y(850)); c.lineTo(X(372), Y(850)); c.lineTo(X(392), Y(1000)); c.lineTo(X(-392), Y(1000)); c.closePath(); };
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 20 * k; gp(); c.fillStyle = lin(c, 0, Y(850), 0, Y(1000), [[0, '#2a333c'], [0.12, '#1c232a'], [1, '#0c1014']]); c.fill(); c.restore();
    c.fillStyle = 'rgba(190,215,235,.22)'; c.fillRect(X(-372), Y(850), 744 * k, 1);
    for (const g of L.gauges) {
      const R = g.r + 9 * k;
      c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 12 * k; c.shadowOffsetY = 4 * k;
      c.fillStyle = lin(c, g.x - R, g.y - R, g.x + R, g.y + R, [[0, '#7a8793'], [0.45, '#35404a'], [1, '#12171b']]); c.beginPath(); c.arc(g.x, g.y, R, 0, TAU); c.fill(); c.restore();
      c.fillStyle = '#020304'; c.beginPath(); c.arc(g.x, g.y, g.r + 1.5, 0, TAU); c.fill();
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; screw(c, g.x + Math.cos(a) * (g.r + 4.5 * k), g.y + Math.sin(a) * (g.r + 4.5 * k), Math.max(1.6, 2.4 * k)); }
    }
  }
  // screen housings
  const housing = (q, b, label) => {
    inQuad(c, pr, q, (w, h) => {
      c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 22 * k; c.shadowOffsetY = 8 * k;
      rr(c, -b, -b, w + b * 2, h + b * 2, 12 * k); c.fillStyle = lin(c, 0, -b, 0, h + b, [[0, '#333e48'], [0.1, '#232b33'], [1, '#12171c']]); c.fill(); c.restore();
      c.strokeStyle = 'rgba(190,215,235,.22)'; c.lineWidth = 1; rr(c, -b + 0.5, -b + 0.5, w + b * 2 - 1, h + b * 2 - 1, 12 * k); c.stroke();
      rr(c, -4 * k, -4 * k, w + 8 * k, h + 8 * k, 5 * k); c.fillStyle = '#020304'; c.fill();
      for (const [sx, sy] of [[-b * 0.55, -b * 0.55], [w + b * 0.55, -b * 0.55], [-b * 0.55, h + b * 0.55], [w + b * 0.55, h + b * 0.55]]) screw(c, sx, sy, Math.max(1.6, 2.6 * k));
      if (label) txt(c, label, w / 2, h + b * 0.72, Math.max(7, 9 * k), 'rgba(200,220,235,.38)', 'center', SANS, 700);
    });
  };
  housing(L.q.scrC, 16 * k, '');
  if (L.q.scrL) housing(L.q.scrL, 18 * k, 'PROXIMITY SONAR');
  if (L.q.scrR) housing(L.q.scrR, 18 * k, 'EXTERNAL CAMERA');
  // soft light spill from the screens onto the console
  c.save(); c.globalCompositeOperation = 'source-atop';
  for (const q of [L.q.scrC, L.q.scrL, L.q.scrR]) { if (!q) continue; const [x, y] = [q.o[0] + (q.U[0] + q.V[0]) / 2, q.o[1] + (q.U[1] + q.V[1]) / 2], r = q.w * 0.9;
    const g = c.createRadialGradient(x, y, r * 0.2, x, y, r); g.addColorStop(0, 'rgba(70,150,220,.10)'); g.addColorStop(1, 'rgba(70,150,220,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
  c.restore();
  // side panels
  const plate = (q) => inQuad(c, pr, q, (w, h) => {
    const b = 7 * k; c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 14 * k; c.shadowOffsetY = 4 * k;
    rr(c, -b, -b, w + b * 2, h + b * 2, 6 * k); c.fillStyle = lin(c, 0, -b, 0, h + b, [[0, '#2b343d'], [1, '#12171c']]); c.fill(); c.restore();
    c.strokeStyle = 'rgba(190,215,235,.18)'; c.lineWidth = 1; rr(c, -b + 0.5, -b + 0.5, w + b * 2 - 1, h + b * 2 - 1, 6 * k); c.stroke();
    for (const [sx, sy] of [[-b * 0.4, -b * 0.4], [w + b * 0.4, -b * 0.4]]) screw(c, sx, sy, Math.max(1.5, 2.2 * k));
  });
  if (L.q.btn) plate(L.q.btn);
  if (L.q.bal) plate(L.q.bal);
  if (L.q.lcd) inQuad(c, pr, L.q.lcd, (w, h) => { const b = 6; rr(c, -b, -b, w + b * 2, h + b * 2, 5); c.fillStyle = lin(c, 0, -b, 0, h + b, [[0, '#2e3842'], [1, '#12171c']]); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.stroke(); });
  // camera monitor: punch a hole so the WebGL feed below shows through
  if (L.q.scrR) inQuad(c, pr, L.q.scrR, (w, h) => { c.globalCompositeOperation = 'destination-out'; c.fillRect(0, 0, w, h); });
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
function led(c, x, y, r, st) {
  const col = LED[st]; c.save();
  if (col) { c.shadowColor = col; c.shadowBlur = r * 3; c.fillStyle = col; } else c.fillStyle = '#18211c';
  rr(c, x - r, y - r, r * 2, r * 2, r * 0.3); c.fill(); c.restore();
  c.fillStyle = col ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.06)'; c.fillRect(x - r * 0.6, y - r * 0.7, r * 1.2, r * 0.35);
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

function button(c, x, y, w, h, label, lit, s) {
  c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 3 * s; c.shadowOffsetY = 1.5 * s; rr(c, x, y, w, h, 3 * s); c.fillStyle = lin(c, 0, y, 0, y + h, [[0, '#2a3138'], [1, '#14181c']]); c.fill(); c.restore();
  c.strokeStyle = 'rgba(255,255,255,.1)'; c.lineWidth = 1; rr(c, x + 0.5, y + 0.5, w - 1, h - 1, 3 * s); c.stroke();
  const col = lit ? LED[lit] : null;
  if (col) { c.save(); c.shadowColor = col; c.shadowBlur = 6 * s; txt(c, label, x + w / 2, y + h * 0.66, h * 0.44, col, 'center', SANS, 700); c.restore(); }
  else txt(c, label, x + w / 2, y + h * 0.66, h * 0.44, 'rgba(210,222,230,.62)', 'center', SANS, 700);
}
export function drawBtnPanel(c, w, h, st) {
  c.clearRect(0, 0, w, h); const s = h / 94, rh = h / 4, on = blinkOn(st.t, 1.2);
  const rows = [['LIGHT', st.alive ? 'g' : ''], ['SONAR', st.sonarCd > 0 ? (on ? 'a' : '') : 'g'], ['CAMERA', st.camOn ? 'g' : 'a'], ['SYSTEM', st.sys === 'ok' ? 'g' : on ? (st.sys === 'bad' ? 'r' : 'a') : '']];
  rows.forEach(([lab, stt], i) => { const y = i * rh + rh / 2; led(c, 9 * s, y, 4.2 * s, stt); button(c, 20 * s, y - rh * 0.38, w - 44 * s, rh * 0.76, lab, '', s);
    c.fillStyle = stt ? 'rgba(255,190,90,.9)' : '#2a2418'; c.beginPath(); c.arc(w - 12 * s, y, 3.2 * s, 0, TAU); c.fill(); });
}
export function drawBallast(c, w, h, st) {
  c.clearRect(0, 0, w, h); const s = h / 94, u = st.inp.u || 0, on = blinkOn(st.t, 1.4);
  txt(c, 'BALLAST', 8 * s, 14 * s, 9 * s, 'rgba(210,222,230,.55)', 'left', SANS, 800);
  const bw = w * 0.6; button(c, 6 * s, 22 * s, bw, 30 * s, '▲ BLOW', u > 0.2 ? 'c' : '', s); button(c, 6 * s, 58 * s, bw, 30 * s, '▼ FLOOD', u < -0.2 ? 'c' : '', s);
  const ax = w - (w - bw - 6 * s) / 2, ay = 50 * s, ar = Math.min(15 * s, (w - bw) * 0.34), lit = st.alert && on;
  c.fillStyle = '#1b1f23'; c.beginPath(); c.arc(ax, ay, ar + 3 * s, 0, TAU); c.fill();
  c.save(); if (lit) { c.shadowColor = '#ff3b30'; c.shadowBlur = 16 * s; }
  const g = c.createRadialGradient(ax - ar * 0.3, ay - ar * 0.3, ar * 0.1, ax, ay, ar); g.addColorStop(0, lit ? '#ffb3a8' : '#6a2522'); g.addColorStop(1, lit ? '#e0241b' : '#2a0d0c'); c.fillStyle = g;
  c.beginPath(); c.arc(ax, ay, ar, 0, TAU); c.fill(); c.restore();
  txt(c, 'ALARM', ax, ay + ar + 12 * s, 7.5 * s, 'rgba(210,222,230,.5)', 'center', SANS, 800);
}
export function drawLcd(c, w, h, st) {
  screenBase(c, w, h, '#0b1f13', '#06120b'); const s = w / 80, col = '#7dffa8', dim = 'rgba(125,255,168,.6)';
  c.save(); c.shadowColor = col; c.shadowBlur = 5 * s;
  txt(c, 'DEPTH', 7 * s, 15 * s, 9 * s, dim, 'left', SANS, 700);
  txt(c, st.depth.toFixed(1), w - 7 * s, 38 * s, 19 * s, col, 'right', MONO, 600); txt(c, 'm', w - 7 * s, 50 * s, 9 * s, dim, 'right');
  c.fillStyle = 'rgba(125,255,168,.25)'; c.fillRect(7 * s, 57 * s, w - 14 * s, 1);
  txt(c, 'P', 7 * s, 78 * s, 9 * s, dim, 'left', SANS, 700); txt(c, `${(1 + st.depth / 10).toFixed(1)}`, w - 7 * s, 78 * s, 13 * s, col, 'right', MONO, 600); txt(c, 'bar', w - 7 * s, 90 * s, 8 * s, dim, 'right');
  c.restore(); screenGlass(c, w, h);
}

// joystick + gloved hand; side -1 = left, +1 = right. tx/ty in -1..1 (right, forward)
export function drawStick(c, w, h, side, tx, ty, press) {
  c.clearRect(0, 0, w, h); const z = h / 214;
  c.save(); if (side > 0) { c.translate(w, 0); c.scale(-1, 1); tx = -tx; }
  const bx = 160 * z, by = 180 * z;
  // base
  c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.ellipse(bx + 6 * z, by + 8 * z, 70 * z, 24 * z, 0, 0, TAU); c.fill();
  c.fillStyle = lin(c, bx - 64 * z, 0, bx + 64 * z, 0, [[0, '#1a2026'], [0.35, '#4a5560'], [1, '#12171b']]); c.beginPath(); c.ellipse(bx, by, 64 * z, 21 * z, 0, 0, TAU); c.fill();
  c.fillStyle = '#0b0e11'; c.beginPath(); c.ellipse(bx, by - 2 * z, 44 * z, 14 * z, 0, 0, TAU); c.fill();
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; screw(c, bx + Math.cos(a) * 55 * z, by + Math.sin(a) * 17 * z, 2.4 * z); }
  // rubber boot
  const ax = bx + tx * 10 * z, ay = by - 30 * z + ty * 3 * z;
  c.fillStyle = lin(c, bx - 36 * z, 0, bx + 36 * z, 0, [[0, '#07090b'], [0.4, '#262c32'], [1, '#07090b']]); c.beginPath(); c.moveTo(bx - 38 * z, by - 2 * z); c.quadraticCurveTo(bx - 30 * z, by - 20 * z, ax - 11 * z, ay); c.lineTo(ax + 11 * z, ay); c.quadraticCurveTo(bx + 30 * z, by - 20 * z, bx + 38 * z, by - 2 * z); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; for (let i = 1; i < 4; i++) { const t = i / 4, yy = by - 2 * z + (ay - by + 2 * z) * t, hw = (38 - 27 * t) * z; c.beginPath(); c.ellipse(bx + (ax - bx) * t, yy, hw, hw * 0.3, 0, 0, Math.PI); c.stroke(); }
  // grip
  const len = 112 * z * (1 - ty * 0.1);
  c.save(); c.translate(ax, ay); c.rotate(tx * 0.26);
  c.fillStyle = lin(c, -10 * z, 0, 10 * z, 0, [[0, '#8a939b'], [0.5, '#d5dbe0'], [1, '#5b646c']]); c.fillRect(-6 * z, -12 * z, 12 * z, 14 * z);
  c.beginPath(); c.moveTo(-15 * z, -10 * z); c.bezierCurveTo(-19 * z, -len * 0.35, -15 * z, -len * 0.55, -19 * z, -len * 0.8); c.quadraticCurveTo(-22 * z, -len - 6 * z, 0, -len - 8 * z); c.quadraticCurveTo(22 * z, -len - 6 * z, 19 * z, -len * 0.8); c.bezierCurveTo(15 * z, -len * 0.55, 19 * z, -len * 0.35, 15 * z, -10 * z); c.closePath();
  c.fillStyle = lin(c, -20 * z, 0, 20 * z, 0, [[0, '#050607'], [0.3, '#2c3238'], [0.5, '#1a1e22'], [1, '#040506']]); c.fill();
  c.fillStyle = '#1b1f23'; c.beginPath(); c.ellipse(0, -len - 3 * z, 19 * z, 7 * z, 0, 0, TAU); c.fill();
  c.save(); if (press) { c.shadowColor = '#ff3b30'; c.shadowBlur = 14 * z; }
  const g = c.createRadialGradient(-2 * z, -len - 7 * z, 1, 1 * z, -len - 4 * z, 10 * z); g.addColorStop(0, press ? '#ffb0a6' : '#ff7a6e'); g.addColorStop(1, press ? '#e3261c' : '#9c1d17'); c.fillStyle = g;
  c.beginPath(); c.ellipse(2 * z, -len - 5 * z, 9 * z, 5.5 * z, 0, 0, TAU); c.fill(); c.restore();
  hand(c, z, len);
  c.restore(); c.restore();
}
function hand(c, z, len) {
  const Z = (v) => v * z;
  // sleeve and cuff
  c.fillStyle = lin(c, Z(-90), Z(220), Z(10), Z(0), [[0, '#05080b'], [0.7, '#141d26'], [1, '#213040']]);
  c.beginPath(); c.moveTo(Z(-46), Z(-4)); c.bezierCurveTo(Z(-60), Z(50), Z(-84), Z(120), Z(-110), Z(240)); c.lineTo(Z(6), Z(240)); c.bezierCurveTo(Z(4), Z(120), Z(8), Z(50), Z(12), Z(2)); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(150,185,220,.22)'; c.lineWidth = Z(1.5); c.beginPath(); c.moveTo(Z(12), Z(4)); c.bezierCurveTo(Z(8), Z(50), Z(4), Z(120), Z(6), Z(240)); c.stroke();
  c.fillStyle = '#0c1116'; c.beginPath(); c.moveTo(Z(-50), Z(-12)); c.lineTo(Z(14), Z(-6)); c.lineTo(Z(13), Z(10)); c.lineTo(Z(-52), Z(4)); c.closePath(); c.fill();
  c.fillStyle = 'rgba(150,185,220,.18)'; c.fillRect(Z(-50), Z(-12), Z(64), Z(1.2));
  // back of the hand on the outer side of the grip
  c.beginPath(); c.moveTo(Z(-46), Z(-10)); c.bezierCurveTo(Z(-60), Z(-34), Z(-58), Z(-68), Z(-42), Z(-86)); c.quadraticCurveTo(Z(-30), Z(-92), Z(-20), Z(-84)); c.lineTo(Z(-16), Z(-8)); c.closePath();
  c.fillStyle = lin(c, Z(-60), Z(-90), Z(-16), Z(-10), [[0, '#626b75'], [0.4, '#3a4149'], [1, '#1a1e23']]); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke();
  // four fingers wrapped across the grip, index finger on top
  for (const [y, t] of [[-73, 13], [-58, 14], [-43, 14], [-28, 13]]) {
    const x0 = -44, x1 = 24, r = t / 2;
    c.beginPath(); c.moveTo(Z(x0), Z(y - r)); c.bezierCurveTo(Z(-12), Z(y - r - 3), Z(10), Z(y - r - 1), Z(x1 - r), Z(y - r + 1)); c.arc(Z(x1 - r), Z(y + 1), Z(r), -Math.PI / 2, Math.PI / 2); c.bezierCurveTo(Z(10), Z(y + r + 2), Z(-12), Z(y + r + 2), Z(x0), Z(y + r)); c.closePath();
    c.fillStyle = lin(c, 0, Z(y - r), 0, Z(y + r), [[0, '#6a737d'], [0.35, '#40474f'], [1, '#1b1f24']]); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = 'rgba(210,230,245,.16)'; c.beginPath(); c.ellipse(Z(x0 + 7), Z(y - r * 0.35), Z(5), Z(r * 0.35), 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.moveTo(Z(-4), Z(y - r + 1)); c.lineTo(Z(-5), Z(y + r - 1)); c.stroke();
  }
  // thumb over the top of the grip, resting beside the button
  const tip = [-7, -len / z - 1];
  c.lineCap = 'round';
  c.strokeStyle = '#1a1e23'; c.lineWidth = Z(19); c.beginPath(); c.moveTo(Z(-40), Z(-70)); c.quadraticCurveTo(Z(-36), Z(tip[1] + 2), Z(tip[0]), Z(tip[1])); c.stroke();
  c.strokeStyle = '#48505a'; c.lineWidth = Z(16); c.beginPath(); c.moveTo(Z(-40), Z(-70)); c.quadraticCurveTo(Z(-36), Z(tip[1] + 2), Z(tip[0]), Z(tip[1])); c.stroke();
  c.strokeStyle = 'rgba(210,230,245,.22)'; c.lineWidth = Z(3); c.beginPath(); c.moveTo(Z(-44), Z(-74)); c.quadraticCurveTo(Z(-40), Z(tip[1] - 2), Z(tip[0] - 2), Z(tip[1] - 5)); c.stroke();
  c.lineCap = 'butt';
}

// ---------------------------------------------------------------- instrument manager
export class CockpitUI {
  constructor(root) { this.root = root; this.cv = {}; this.acc = {}; this.sig = {}; this.L = null; this.dpr = 1; }
  setLayout(L, dpr) {
    this.L = L; this.dpr = dpr; const want = {};
    for (const [id, q] of Object.entries(L.q)) if (q) want[id] = q;
    L.gauges.forEach((g, i) => { want['g' + i] = Q([g.x - g.r, g.y - g.r], [g.r * 2, 0], [0, g.r * 2]); });
    for (const id of Object.keys(this.cv)) if (!want[id]) { this.cv[id].remove(); delete this.cv[id]; }
    for (const [id, q] of Object.entries(want)) {
      let el = this.cv[id]; if (!el) { el = document.createElement('canvas'); el.dataset.id = id; this.root.appendChild(el); this.cv[id] = el; }
      el.width = Math.max(1, Math.round(q.w * dpr)); el.height = Math.max(1, Math.round(q.h * dpr)); el.style.width = q.w + 'px'; el.style.height = q.h + 'px';
      el.style.transform = `matrix(${quadMatrix(q).map((v) => +v.toFixed(5)).join(',')})`; el.style.zIndex = id.startsWith('stick') ? 2 : 1; el._q = q;
    }
    this.acc = {}; this.sig = {};
  }
  ctx(id) { const el = this.cv[id]; const c = el.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); return c; }
  run(id, every, dt, fn) { if (!this.cv[id]) return; this.acc[id] = (this.acc[id] ?? every) + dt; if (this.acc[id] < every) return; this.acc[id] = 0; const q = this.cv[id]._q; fn(this.ctx(id), q.w, q.h); }
  once(id, sig, fn) { if (!this.cv[id] || this.sig[id] === sig) return; this.sig[id] = sig; const q = this.cv[id]._q; fn(this.ctx(id), q.w, q.h); }
  update(st, dt) {
    this.run('scrL', 1 / 20, dt, (c, w, h) => drawRadarScr(c, w, h, st));
    this.run('scrC', 1 / 12, dt, (c, w, h) => drawNav(c, w, h, st));
    this.run('scrR', 1 / 4, dt, (c, w, h) => drawCamOverlay(c, w, h, st));
    this.run('lcd', 1 / 5, dt, (c, w, h) => drawLcd(c, w, h, st));
    this.L.gauges.forEach((g, i) => this.run('g' + i, 1 / 30, dt, (c, w) => drawGauge(c, w, g.kind, st)));
    const bl = blinkOn(st.t, 1.2) ? 1 : 0, bl2 = blinkOn(st.t, 1.4) ? 1 : 0;
    this.once('annun', [st.bat < 0.1, st.bat < 0.25, st.hull < 0.3, st.hull < 0.6, st.depth > st.limit, st.depth > st.limit * 0.9, st.kg >= st.cargo * 0.92, st.beam, st.boost, st.sonarCd > 0, bl].join(), (c, w, h) => drawAnnun(c, w, h, st));
    this.once('btn', [st.alive, st.sonarCd > 0, st.camOn, st.sys, bl].join(), (c, w, h) => drawBtnPanel(c, w, h, st));
    this.once('bal', [Math.sign(Math.round((st.inp.u || 0) * 2)), !!st.alert, bl2].join(), (c, w, h) => drawBallast(c, w, h, st));
    const r2 = (v) => Math.round(v * 40) / 40;
    const sl = [r2(st.stickL[0]), r2(st.stickL[1]), st.boost], sr = [r2(st.stickR[0]), r2(st.stickR[1]), st.beam];
    this.once('stickL', sl.join(), (c, w, h) => drawStick(c, w, h, -1, sl[0], sl[1], sl[2]));
    this.once('stickR', sr.join(), (c, w, h) => drawStick(c, w, h, 1, sr[0], sr[1], sr[2]));
  }
}
