// First-person cockpit: viewport frame (static canvas) + rotating proximity radar.
import { TAU, clamp, mulberry32 } from './util.js';

function roundRectPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// points along a rounded-rect perimeter, spaced ~step px apart
function perimeter(x, y, w, h, r, step) {
  const pts = [], segs = [];
  const straight = (x0, y0, x1, y1) => segs.push((t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.hypot(x1 - x0, y1 - y0)]);
  const arc = (cx, cy, a0) => segs.push((t) => [cx + Math.cos(a0 + t * Math.PI / 2) * r, cy + Math.sin(a0 + t * Math.PI / 2) * r, r * Math.PI / 2]);
  straight(x + r, y, x + w - r, y); arc(x + w - r, y + r, -Math.PI / 2); straight(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
  straight(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, Math.PI / 2); straight(x, y + h - r, x, y + r); arc(x + r, y + r, Math.PI);
  for (const s of segs) { const len = s(0)[2]; const n = Math.max(1, Math.round(len / step)); for (let i = 0; i < n; i++) { const p = s(i / n); pts.push([p[0], p[1]]); } }
  return pts;
}
export function cockpitWindow(W, H, touch) {
  const mx = Math.max(12, W * 0.022), top = Math.max(10, H * 0.028), bot = touch ? Math.max(14, H * 0.04) : Math.max(90, H * 0.15);
  return { x: mx, y: top, w: W - mx * 2, h: H - top - bot, r: Math.min(W, H) * 0.13 };
}
export function drawCockpit(cv, W, H, pr, tier, touch) {
  cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
  const c = cv.getContext('2d'); c.setTransform(pr, 0, 0, pr, 0, 0); c.clearRect(0, 0, W, H);
  const win = cockpitWindow(W, H, touch), rng = mulberry32(99 + tier);
  // hull plating
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#27323c'); g.addColorStop(0.55, '#151c22'); g.addColorStop(1, '#0a0f13'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.045; c.strokeStyle = '#ffffff'; c.lineWidth = 1; for (let y = 0; y < H; y += 3) { c.beginPath(); c.moveTo(0, y + rng()); c.lineTo(W, y + rng()); c.stroke(); } c.globalAlpha = 1;
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 2; for (const x of [W * 0.33, W * 0.67]) { c.beginPath(); c.moveTo(x, win.y + win.h + 8); c.lineTo(x, H); c.stroke(); }
  // viewport cut-out
  c.save(); c.globalCompositeOperation = 'destination-out'; roundRectPath(c, win.x, win.y, win.w, win.h, win.r); c.fill(); c.restore();
  // inner glass shading, reflections and damage
  c.save(); roundRectPath(c, win.x, win.y, win.w, win.h, win.r); c.clip();
  const rg = c.createRadialGradient(W / 2, win.y + win.h / 2, Math.min(win.w, win.h) * 0.38, W / 2, win.y + win.h / 2, Math.hypot(win.w, win.h) * 0.56);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,10,16,.62)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  for (const [x0, w0, a] of [[0.1, 0.07, 0.05], [0.2, 0.025, 0.045], [0.74, 0.05, 0.03]]) {
    const lg = c.createLinearGradient(W * x0, 0, W * (x0 + w0), 0); lg.addColorStop(0, 'rgba(210,240,255,0)'); lg.addColorStop(0.5, `rgba(210,240,255,${a})`); lg.addColorStop(1, 'rgba(210,240,255,0)');
    c.fillStyle = lg; c.beginPath(); c.moveTo(W * x0 + H * 0.25, win.y); c.lineTo(W * (x0 + w0) + H * 0.25, win.y); c.lineTo(W * (x0 + w0) - H * 0.1, win.y + win.h); c.lineTo(W * x0 - H * 0.1, win.y + win.h); c.closePath(); c.fill(); }
  if (tier > 0) {
    const n = tier === 1 ? 2 : 5;
    for (let k = 0; k < n; k++) {
      const edge = rng() * 4 | 0; let x = edge === 0 ? win.x + rng() * win.w : edge === 1 ? win.x + win.w : edge === 2 ? win.x + rng() * win.w : win.x, y = edge === 1 || edge === 3 ? win.y + rng() * win.h : edge === 0 ? win.y : win.y + win.h;
      let a = Math.atan2(win.y + win.h / 2 - y, W / 2 - x) + (rng() - 0.5) * 1.2;
      const draw = (x, y, a, len, depth) => { const pts = [[x, y]]; for (let s = 0; s < 7; s++) { a += (rng() - 0.5) * 0.7; x += Math.cos(a) * len / 7; y += Math.sin(a) * len / 7; pts.push([x, y]); }
        for (const [col, w, dx] of [['rgba(0,0,0,.5)', 2.2, 1], ['rgba(230,245,255,.75)', 1.1, 0]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px + dx, py + dx) : c.moveTo(px + dx, py + dx))); c.stroke(); }
        if (depth > 0) for (let b = 0; b < 2; b++) { const p = pts[2 + (rng() * 4 | 0)]; draw(p[0], p[1], a + (rng() - 0.5) * 2, len * 0.5, depth - 1); } };
      draw(x, y, a, Math.min(W, H) * (0.18 + rng() * 0.2), 2);
    }
  }
  c.restore();
  // bevelled frame + bolts
  const bg = c.createLinearGradient(win.x, win.y, win.x + win.w, win.y + win.h); bg.addColorStop(0, '#6c7e8e'); bg.addColorStop(0.45, '#2c3843'); bg.addColorStop(1, '#10161b');
  c.lineWidth = 12; c.strokeStyle = bg; roundRectPath(c, win.x - 6, win.y - 6, win.w + 12, win.h + 12, win.r + 6); c.stroke();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(170,220,245,.28)'; roundRectPath(c, win.x, win.y, win.w, win.h, win.r); c.stroke();
  c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.6)'; roundRectPath(c, win.x - 12.5, win.y - 12.5, win.w + 25, win.h + 25, win.r + 12); c.stroke();
  for (const [px, py] of perimeter(win.x - 20, win.y - 20, win.w + 40, win.h + 40, win.r + 20, touch ? 70 : 58)) {
    if (px < 3 || py < 3 || px > W - 3 || py > H - 3) continue;
    const bgr = c.createRadialGradient(px - 1.2, py - 1.2, 0.5, px, py, 4.2); bgr.addColorStop(0, '#a9b6c1'); bgr.addColorStop(1, '#2a333b');
    c.fillStyle = bgr; c.beginPath(); c.arc(px, py, 4, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.stroke();
  }
  if (!touch) {
    c.fillStyle = 'rgba(160,190,210,.35)'; c.font = '800 10px sans-serif'; c.textAlign = 'left'; c.fillText('DSV DEEP BLUE-3  ·  RV 푸른바다', win.x + 14, H - 10);
    c.textAlign = 'right'; c.fillText('PRESSURE HULL Ti-6Al-4V  ·  VIEWPORT ACRYLIC 180mm', W - win.x - 14, H - 10);
  }
}
export const headingDeg = (yaw) => ((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI + 360) % 360;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const headingLabel = (yaw) => { const d = headingDeg(yaw); return `${DIRS[Math.round(d / 45) % 8]} ${String(Math.round(d) % 360).padStart(3, '0')}°`; };

// st: {t, pos, yaw, range, items, rescues, creatures, dock, target}
export function drawRadar(cv, st) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 6, k = R / st.range;
  const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw), rx = -Math.cos(st.yaw), rz = Math.sin(st.yaw);
  const toS = (x, z) => { const dx = x - st.pos.x, dz = z - st.pos.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k]; };
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
  const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R); bg.addColorStop(0, '#062a26'); bg.addColorStop(1, '#010d0c'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(90,255,200,.22)'; c.lineWidth = 1.5; for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, (R * i) / 3, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
  const sw = (st.t * 2.4) % TAU; const sg = c.createConicGradient ? c.createConicGradient(sw - Math.PI / 2 - 0.9, cx, cy) : null;
  if (sg) { sg.addColorStop(0, 'rgba(90,255,200,0)'); sg.addColorStop(0.14, 'rgba(90,255,200,.28)'); sg.addColorStop(0.1401, 'rgba(90,255,200,0)'); c.fillStyle = sg; c.fillRect(0, 0, W, H); }
  const blip = (x, z, dy, col, r) => { const [sx, sy] = toS(x, z); if ((sx - cx) ** 2 + (sy - cy) ** 2 > R * R) return; c.fillStyle = col; c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fill();
    if (Math.abs(dy) > 6) { c.beginPath(); const d = dy > 0 ? -1 : 1; c.moveTo(sx - 3.5, sy + d * (r + 2)); c.lineTo(sx + 3.5, sy + d * (r + 2)); c.lineTo(sx, sy + d * (r + 7)); c.closePath(); c.fill(); } };
  const r2 = st.range * st.range;
  for (const it of st.items) { if (it.col || it.locked) continue; const dx = it.pos.x - st.pos.x, dz = it.pos.z - st.pos.z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
    const near = d2 < (st.range * 0.75) ** 2; if (!near && !it.known) continue; blip(it.pos.x, it.pos.z, it.pos.y - st.pos.y, it.tr ? '#ffd23f' : it.known ? '#ff9a6a' : 'rgba(255,154,106,.6)', it.kg > 5 ? 4.5 : 3.2); }
  for (const r of st.rescues) if (!r.freed) blip(r.pos.x, r.pos.z, r.pos.y - st.pos.y, '#ff4fa3', 5.5);
  for (const e of st.creatures) { if (e.a < 0.5) continue; const hz = e.sp === 'shark' ? (e.state === 1 ? '#ff3b3b' : 'rgba(255,90,90,.75)') : e.sp === 'jelly' ? 'rgba(190,140,255,.8)' : e.sp === 'angler' ? 'rgba(255,120,90,.8)' : null; if (!hz) continue; blip(e.pos.x, e.pos.z, e.pos.y - st.pos.y, hz, e.sp === 'shark' ? 4.5 : 2.6); }
  const edgeMark = (p, col, label) => { let [sx, sy] = toS(p.x, p.z); const dx = sx - cx, dy = sy - cy, d = Math.hypot(dx, dy); if (d > R - 10) { sx = cx + (dx / d) * (R - 10); sy = cy + (dy / d) * (R - 10); }
    c.fillStyle = col; c.save(); c.translate(sx, sy); c.rotate(Math.atan2(dy, dx) + Math.PI / 2); c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 5); c.lineTo(-6, 5); c.closePath(); c.fill(); c.restore();
    if (label) { c.font = '900 16px sans-serif'; c.textAlign = 'center'; c.fillText(label, sx, sy + (sy < cy ? 22 : -12)); } };
  if (st.target) edgeMark(st.target, '#ffb000', '');
  edgeMark(st.dock, '#5dff9a', '');
  c.restore();
  c.fillStyle = '#ffd23f'; c.beginPath(); c.moveTo(cx, cy - 10); c.lineTo(cx + 7, cy + 7); c.lineTo(cx, cy + 3); c.lineTo(cx - 7, cy + 7); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(90,255,200,.5)'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  c.fillStyle = 'rgba(150,255,220,.75)'; c.font = '800 15px sans-serif'; c.textAlign = 'center'; c.fillText(`${st.range}m`, cx, cy + R - 12); c.fillText('▲', cx, cy - R + 20);
}
export { clamp };
