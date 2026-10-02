// End-to-end checks for the built game (../ocean-cleanup-3d.html), run in headless Chromium with a
// software GPU. `npm test` runs every suite; `npm test -- core story` runs the named ones.
// Each check prints ok/FAIL; the process exits non-zero if any check failed or the page logged an error.
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const GAME = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), '../../ocean-cleanup-3d.html');
const SAVE_KEY = 'deepblue3d-ocean-cleaner-v1', SET_KEY = 'deepblue3d-settings-v1';
let failed = 0; const OPEN = [], PAGES = []; // contexts still open, closed after each suite even if it crashed; their pages, for crash reports
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) failed++; };

// a fresh browser context with fixed settings (low quality keeps the software renderer fast)
async function open(browser, { query = '', settings = { quality: 0, master: 0, fp: 1 }, save = null, device = null } = {}) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 900, height: 560 } }); OPEN.push(ctx);
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('crash', () => errors.push('page crashed')); PAGES.push({ page, errors });
  await page.addInitScript(([sk, s, vk, v]) => { if (s) localStorage.setItem(sk, JSON.stringify(s)); if (v) localStorage.setItem(vk, JSON.stringify(v)); }, [SET_KEY, settings, SAVE_KEY, save]);
  await page.goto(GAME + query); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
  const E = (f, a) => page.evaluate(f, a), sim = (s) => E((s) => window.__game.simulate(s), s);
  return { ctx, page, errors, E, sim };
}

const SUITES = {
  // the main loop: collecting, beam, sonar, dock and shop, rescue, codex, map, pressure failure, save/continue
  async core(browser) {
    const { ctx, page, errors, E, sim } = await open(browser);
    await page.click('#bNew'); await page.waitForTimeout(400);
    let id = await E(() => { const g = window.__game, it = g.items.find((i) => !i.locked && i.buoy < 0 && i.kg <= 2); g.P.pos.set(it.pos.x, it.pos.y + 1.2, it.pos.z); g.P.vel.set(0, 0, 0); return it.id; });
    await sim(0.5); check('contact collect', await E((id) => window.__game.items[id].col, id));
    id = await E(() => { const g = window.__game, it = g.items.find((i) => !i.col && !i.locked && i.buoy < 0 && i.kg <= 2 && Math.hypot(i.pos.x, i.pos.z) > 40), p = -0.2;
      g.P.yaw = g.P.vyaw = 0; g.P.pitch = p; g.P.pos.set(it.pos.x, it.pos.y + 10 * Math.sin(-p) + 0.5, it.pos.z - 10 * Math.cos(p)); g.P.vel.set(0, 0, 0); return it.id; });
    await page.keyboard.down('KeyE'); await sim(2.9); const glowOn = await E(() => window.__game.SUB.emitter.material.color.g); await page.keyboard.up('KeyE');
    check('beam collect', await E((id) => window.__game.items[id].col, id));
    // the sub: every part hides in the cockpit and shows in the chase view; the beam projector glows while beaming
    const sub = await E(() => { const g = window.__game, U = g.SUB, parts = [U.bodyMesh, U.prop, U.emitter, U.beacon, ...U.thr], hid = parts.every((m) => !m.visible); g.toggleView(); const shown = parts.every((m) => m.visible); g.toggleView(); g.simulate(0.1); return { hid, shown, glowOff: U.emitter.material.color.g }; });
    check('sub parts hide in the cockpit, show in the chase view', sub.hid && sub.shown, sub);
    check('beam projector glows while the beam is on', glowOn > sub.glowOff * 2, { glowOn, glowOff: sub.glowOff });
    check('the sub lamp lights the deep', await E(() => { const g = window.__game; g.P.pos.set(330, -282, -360); g.SV().up.depth = 5; g.calcStats(); g.simulate(0.1); g.updateEnv(0.016); let s = null; g.scene.traverse((o) => { if (o.isSpotLight) s = o; }); const ok = !!s && s.intensity > 20 && s.parent && s.parent.visible !== undefined; g.SV().up.depth = 0; g.calcStats(); g.P.pos.set(0, -12, -40); return ok; }));
    await page.keyboard.press('KeyQ'); await sim(2.4); check('sonar reveals items', await E(() => window.__game.items.filter((i) => i.known).length) > 5);
    await E(() => { const g = window.__game; g.SV().money = 500; g.P.canDock = true; g.P.pos.copy(g.DOCK); }); await sim(0.1);
    check('dock opens and sells', await E(() => window.__game.G.state === 'dock' && window.__game.SV().stats.sells === 1));
    await page.click('.tab[data-tab="dUp"]'); await page.click('[data-buy="depth"]:not([disabled])');
    check('upgrade bought', await E(() => window.__game.SV().up.depth === 1));
    await page.click('#bLaunch'); check('launch', await E(() => window.__game.G.state === 'play'));
    // the lock is granted asynchronously: one landing outside play must be let go, and the jump it reports must not turn the sub
    check('late pointer lock released, lock-jump mouse move ignored', await E(() => { const g = window.__game, IN = g.IN, d = document, c = g.renderer.domElement, ex = d.exitPointerLock; let exited = 0;
      Object.defineProperty(d, 'pointerLockElement', { configurable: true, get: () => c }); d.exitPointerLock = () => { exited++; };
      g.G.state = 'dock'; d.dispatchEvent(new Event('pointerlockchange')); g.G.state = 'play'; delete d.pointerLockElement; d.exitPointerLock = ex;
      IN.locked = true; IN.mdx = 0; dispatchEvent(new MouseEvent('mousemove', { movementX: -772, movementY: -493 })); const spike = IN.mdx; dispatchEvent(new MouseEvent('mousemove', { movementX: 30 })); const hand = IN.mdx; IN.locked = false; IN.mdx = IN.mdy = 0;
      return exited === 1 && spike === 0 && hand === 30; }));
    const cut = await E(() => { const g = window.__game, r = g.rescues[0]; g.P.yaw = g.P.vyaw = 0; g.P.pitch = 0; g.P.pos.set(r.pos.x, r.pos.y + 0.3, r.pos.z - 9); g.P.vel.set(0, 0, 0); return g.S.cut; });
    await page.keyboard.down('KeyE'); await sim(cut + 2); await page.keyboard.up('KeyE');
    check('rescue frees the animal', await E(() => window.__game.rescues[0].freed));
    await page.keyboard.press('Tab'); await page.waitForTimeout(3000);
    check('codex renders species cards', await E(() => document.querySelectorAll('#cgrid .ccard').length >= 17));
    await page.keyboard.press('Escape'); await page.keyboard.press('KeyM'); await page.waitForTimeout(800); await page.keyboard.press('KeyM'); await page.waitForTimeout(200);
    check('map opens and closes', await E(() => window.__game.G.state === 'play'));
    await E(() => { const g = window.__game; g.P.pos.set(-760, g.heightAt(-760, 150) + 10, 150); }); await sim(2);
    check('pressure failure', await page.waitForFunction(() => window.__game.G.state === 'fail' && !document.getElementById('fail').classList.contains('hidden'), null, { timeout: 15000 }).then(() => true, () => false));
    await page.click('#bRespawn'); await page.waitForTimeout(300); check('respawn at the dock', await E(() => window.__game.G.state === 'dock'));
    await page.click('#bLaunch'); await E(() => window.__game.saveGame()); const saved = await E((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);
    check('core: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close();
    // a fresh boot from that save, with the first page closed (a reload instead can race Chromium's storage under load and come up without it)
    const next = await open(browser, { save: saved }); await next.page.click('#bContinue'); await next.page.waitForTimeout(400);
    check('continue restores the save', await next.E((m) => { const g = window.__game; return g.SV().money === m && g.rescues[0].freed && g.SV().up.depth === 1; }, saved.money));
    check('continue: no page errors', next.errors.length === 0, next.errors.slice(0, 3)); await next.ctx.close();
  },
  // the bleached reef: the valve closes under the beam, the zone's trash is reachable, colour and fish come back
  async sites(browser) {
    const { ctx, page, errors, E } = await open(browser);
    await page.click('#bNew'); await page.waitForTimeout(400);
    await E(() => { const g = window.__game, SV = g.SV(); SV.mission = g.MISSIONS.findIndex((m) => m.site === 'bleach'); SV.up.cargo = 5; g.calcStats(); g.P.pos.set(20, -12, -40); g.G.tick = 0.29; g.simulate(1 / 30); window.__v = g.G.guide.p.clone(); });
    check('guide points at the valve first', await E(() => window.__game.G.guide.label.includes('밸브')));
    await page.keyboard.down('KeyE');
    await E(() => { const g = window.__game, v = window.__v; g.P.pos.set(v.x - 6, v.y + 2, v.z - 3); for (let t = 0; t < 6 && !g.SV().valve; t += 1 / 30) { g.P.yaw = g.P.vyaw = Math.atan2(v.x - g.P.pos.x, v.z - g.P.pos.z); g.P.pitch = Math.atan2(v.y - g.P.pos.y, Math.hypot(v.x - g.P.pos.x, v.z - g.P.pos.z)); g.P.vel.set(0, 0, 0); g.simulate(1 / 30); } });
    await page.keyboard.up('KeyE'); check('valve closes under the beam', await E(() => window.__game.SV().valve));
    const r = await E(() => { const g = window.__game, S = g.SITES.find((s) => s.id === 'bleach'); let miss = 0;
      for (const id of S.ids) { const it = g.items[id]; for (const dy of [2.5, 0, 4, -1]) { if (it.col) break; g.P.pos.set(it.pos.x, it.pos.y + dy, it.pos.z); g.P.vel.set(0, 0, 0); for (let k = 0; k < 6 && !it.col; k++) g.simulate(1 / 30); } if (!it.col) miss++; }
      g.G.tick = 0.29; g.simulate(1 / 30); for (let i = 0; i < 200; i++) g.simulate(1 / 20);
      return { miss, done: !!g.SV().sites.bleach, h: g.G.bleachH, fish: g.schools.filter((s) => s.site === 'bleach').every((s) => s.on) }; });
    check('every bleached-reef item is reachable', r.miss === 0, r.miss); check('reef recovers colour and fish', r.done && r.h > 0.95 && r.fish, r);
    check('sites: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close();
  },
  // story mode played start to finish by a bot holding W and E, then the quiz; the main save must be untouched
  async story(browser) {
    const save = { v: 1, mv: 3, money: 4321, mission: 9, stats: { collected: 77 }, up: {} };
    const { ctx, page, errors, E } = await open(browser, { query: '?story', save });
    check('class link highlights story mode', await E(() => document.getElementById('bStory').classList.contains('primary')));
    await page.click('#bStory'); await page.waitForTimeout(400);
    let goals = 0;
    for (let guard = 0; guard < 40; guard++) {
      const st = await E(() => ({ talk: window.__game.G.talk, state: window.__game.G.state })); if (st.state === 'menu') break;
      if (st.talk) { await page.keyboard.press('Enter'); await page.waitForTimeout(30); continue; }
      await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE');
      for (let chunk = 0; chunk < 40; chunk++) {
        const r = await E(() => { const g = window.__game; for (let n = 0; n < 150 && !g.G.talk && g.G.state === 'play'; n++) { const gd = g.G.guide; if (gd) { const dx = gd.p.x - g.P.pos.x, dy = gd.p.y - g.P.pos.y, dz = gd.p.z - g.P.pos.z; g.P.yaw = g.P.vyaw = Math.atan2(dx, dz); g.P.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz)))); if (Math.hypot(dx, dy, dz) < 3) g.P.vel.multiplyScalar(0.7); } g.simulate(1 / 30); } return g.G.talk || g.G.state !== 'play'; });
        if (r) break;
      }
      await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE'); goals++;
    }
    const end = await E(() => { const g = window.__game; return { shown: !document.getElementById('storyEnd').classList.contains('hidden'), hold: g.P.cargo.length, secs: Math.round(g.SV().stats.time) }; });
    check('story reaches the ending card after six goals', end.shown && goals === 6, { goals, secs: end.secs });
    check('the last goal brings the trash back to the ship', end.hold === 0);
    check('reef healed and fish back in the story', await E(() => window.__game.G.bleachH > 0.5 && window.__game.schools.filter((s) => s.site === 'bleach').every((s) => s.on)));
    await page.click('#seQuiz'); for (let i = 0; i < 3; i++) { await page.click('#storyEnd .ox .ans-o'); await page.click('#seNext'); }
    check('quiz scores 2/3 for O,O,O', await E(() => document.getElementById('seBody').innerText.includes('2문제')));
    await page.click('#seHome'); await page.waitForTimeout(300);
    check('back at the title', await E(() => window.__game.G.state === 'title'));
    check('main save untouched', await E((k) => { const d = JSON.parse(localStorage.getItem(k)); return d.money === 4321 && d.mission === 9 && d.stats.collected === 77; }, SAVE_KEY));
    check('story: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close();
  },
  // graphics quality: auto by default and adapting to real frame times, a 최고 tier at full pixel density,
  // and recovery when the browser drops the WebGL context
  async quality(browser) {
    { const { ctx, page, errors, E } = await open(browser, { settings: null, device: 'iPad Pro 11 landscape' });
      check('auto quality is the default', await E(() => document.getElementById('sQuality').value === 'auto' && window.__game.G.quality === 2));
      await page.tap('#bNew'); // the software renderer manages about one frame a second, so auto mode should step down
      check('auto quality steps down on slow frames', await page.waitForFunction(() => window.__game.G.quality < 2, null, { timeout: 60000 }).then(() => true, () => false), await E(() => window.__game.G.quality));
      check('a stepped-down tier is not saved over the auto preference', await E((k) => { const s = localStorage.getItem(k); return !s || JSON.parse(s).quality === 'auto'; }, SET_KEY));
      // feed frame times directly: a fast device climbs to 최고 once, a slow spell drops it back and it stays there
      const steps = await E(() => { const g = window.__game, out = []; g.G.quality = 2; const feed = (ms, n) => { for (let i = 0; i < n; i++) g.autoQuality(ms); out.push(g.G.quality); };
        const s = document.getElementById('sQuality'); s.value = 'auto'; s.dispatchEvent(new Event('change')); feed(14, 500); feed(40, 200); feed(14, 500); return out; });
      check('auto quality climbs on a fast device, drops on slow frames, then stays down', steps.join() === '3,2,2', steps);
      await E(() => { const s = document.getElementById('sQuality'); s.value = '3'; s.dispatchEvent(new Event('change')); });
      check('최고 renders at full iPad pixel density', await E(() => window.__game.G.quality === 3 && window.__game.renderer.getPixelRatio() === 2));
      check('quality: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close(); }
    { const { ctx, page, errors, E, sim } = await open(browser);
      await page.click('#bNew'); await page.waitForTimeout(300);
      await E(() => { window.__lc = window.__game.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lc.loseContext(); }); await page.waitForTimeout(500);
      check('context loss pauses and tells the player', await E(() => window.__game.G.ctxLost && window.__game.G.state === 'pause' && !document.getElementById('ctxLost').classList.contains('hidden')));
      await E(() => window.__lc.restoreContext()); await page.waitForTimeout(1500);
      check('context restore hides the notice', await E(() => !window.__game.G.ctxLost && document.getElementById('ctxLost').classList.contains('hidden') && !window.__game.renderer.getContext().isContextLost()));
      await page.click('#bResume'); await sim(0.5); await page.waitForTimeout(1500);
      check('the game keeps running after a restore', await E(() => window.__game.G.state === 'play'));
      check('context loss: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close(); }
  },
  // touch on a tablet: the five buttons are big enough, apart, on screen and on top; then the stick, pitch assist, beam cone and hints
  async touch(browser) {
    const { ctx, page, errors, E } = await open(browser, { device: 'iPad Pro 11 landscape' });
    await page.tap('#bNew'); await page.waitForTimeout(500);
    const r = await E(() => { const ids = ['tBeam', 'tSonar', 'tBoost', 'tUp', 'tDown'], rs = ids.map((id) => document.getElementById(id).getBoundingClientRect()); let overlap = 0, hit = 0;
      rs.forEach((a, i) => rs.forEach((b, j) => { if (i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlap++; }));
      ids.forEach((id, i) => { const q = rs[i], el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); if (el && el.closest('#' + id)) hit++; });
      return { small: Math.round(rs[1].width), overlap, hit, sonarText: getComputedStyle(document.getElementById('sonarInd')).display }; });
    check('touch buttons are large, separate and tappable', r.small >= 60 && r.overlap === 0 && r.hit === 5, r);
    check('sonar status text hidden on touch', r.sonarText === 'none');
    // controls, driven by synthetic touches inside one evaluate so the live loop can't interleave
    const c = await E(() => { const g = window.__game, P = g.P, IN = g.IN, hid = (id) => document.getElementById(id).classList.contains('hidden');
      const ev = (id, type, x, y, n) => { const el = document.getElementById(id), t = new Touch({ identifier: n, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { changedTouches: [t], touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true })); };
      const o = {}, home = () => { P.pos.set(150, g.heightAt(150, 150) + 40, 150); P.vel.set(0, 0, 0); P.yaw = P.vyaw = 0; P.pitch = 0; };
      home(); g.simulate(0.1); o.hints = !hid('joyHint') && !hid('lookHint');
      ev('joyZone', 'touchstart', 200, 600, 1); ev('joyZone', 'touchmove', 205, 598, 1); o.dead = IN.joy.dx === 0 && IN.joy.dy === 0;
      ev('joyZone', 'touchmove', 256, 600, 1); let y0 = P.yaw; const p0 = P.pos.clone(); g.simulate(1); o.turn = +(y0 - P.yaw).toFixed(2); o.drift = +P.pos.distanceTo(p0).toFixed(2);
      ev('joyZone', 'touchmove', 200, 544, 1); P.pitch = -1.1; y0 = P.yaw; g.simulate(3); o.pitch = +P.pitch.toFixed(2); o.yawHeld = Math.abs(P.yaw - y0) < 1e-6;
      ev('joyZone', 'touchend', 200, 544, 1); g.simulate(0.1); o.joyHintGone = hid('joyHint');
      ev('lookZone', 'touchstart', 900, 400, 2); ev('lookZone', 'touchmove', 960, 400, 2); g.simulate(1); ev('lookZone', 'touchend', 960, 400, 2); g.simulate(0.1); o.lookHintGone = hid('lookHint');
      // an item further off-centre than the mouse beam reaches, but inside the touch cone
      const it = g.items.find((i) => !i.col && !i.locked && i.buoy < 0 && i.kg <= 2 && Math.hypot(i.pos.x, i.pos.z) > 40);
      P.yaw = P.vyaw = 0; P.pitch = -0.2; P.pos.set(it.pos.x, it.pos.y + 10 * Math.sin(0.2) + 0.5, it.pos.z - 10 * Math.cos(0.2)); P.vel.set(0, 0, 0); g.simulate(1 / 30);
      const off = (yaw) => { P.yaw = P.vyaw = yaw; g.simulate(1 / 30); const v = it.pos.clone().sub(P.nose), ed = v.length(); return { a: Math.acos(v.dot(P.fwd) / ed), lim: 0.36 + Math.min(0.5, it.r / ed) }; };
      let yaw = 0.4, q = off(yaw); for (let k = 0; k < 8; k++) { yaw += q.lim + 0.07 - q.a; q = off(yaw); }
      o.angle = +q.a.toFixed(2); o.mouseLimit = +q.lim.toFixed(2); o.nudge = document.getElementById('tBeam').classList.contains('nudge');
      ev('tBeam', 'touchstart', 0, 0, 3); for (let t = 0; t < 3 && !it.col; t += 1 / 30) g.simulate(1 / 30); ev('tBeam', 'touchend', 0, 0, 3); g.simulate(0.1);
      o.collected = it.col; o.tip = !!g.SV().tips.tbeam; o.nudgeGone = !document.getElementById('tBeam').classList.contains('nudge'); return o; });
    check('touch: hints show on first play', c.hints, c);
    check('joystick dead zone', c.dead);
    check('sideways joystick steers instead of strafing', c.turn > 1.6 && c.turn < 2.1 && c.drift < 0.5, { turn: c.turn, drift: c.drift });
    check('cruising relaxes a steep pitch', c.pitch > -0.5 && c.yawHeld, c.pitch);
    check('move and look hints go once used', c.joyHintGone && c.lookHintGone);
    check('touch beam reaches further off-centre', c.angle > c.mouseLimit && c.collected, { angle: c.angle, mouse: c.mouseLimit });
    check('beam button pulses until the beam is used', c.nudge && c.tip && c.nudgeGone);
    check('touch: no page errors', errors.length === 0, errors.slice(0, 3)); await ctx.close();
  },
};

// after a crash: what each open page was showing and any errors it logged, so a CI failure explains itself
async function report() {
  for (const { page, errors } of PAGES.splice(0)) {
    const st = await Promise.race([page.evaluate(() => { const g = window.__game; return { state: g && g.G.state, ctxLost: g && g.G.ctxLost, shown: [...document.querySelectorAll('body > div[id]:not(.hidden)')].map((e) => e.id) }; }).catch((e) => e.message.split('\n')[0]), new Promise((r) => setTimeout(() => r('page not answering'), 5000))]);
    console.log('     page:', JSON.stringify(st), '| errors:', JSON.stringify(errors.slice(0, 5)));
  }
}
const want = process.argv.slice(2).filter((a) => SUITES[a]), run = want.length ? want : Object.keys(SUITES);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const name of run) { const t = Date.now(); console.log(`# ${name}`); try { await SUITES[name](browser); } catch (e) { check(`${name} crashed`, false, e.message.split('\n').filter((l) => l.trim()).slice(0, 12).join(' | ')); await report(); } PAGES.length = 0; for (const c of OPEN.splice(0)) await c.close().catch(() => {}); console.log(`# ${name} done in ${Math.round((Date.now() - t) / 1000)}s`); }
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed'); process.exit(failed ? 1 : 0);
