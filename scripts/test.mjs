// Safety checks. Nothing is published unless all of these pass.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const GAME = process.env.GAME || process.argv[2] || 'itsy-big-show';
const DIR = `site/games/${GAME}`;
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };
const cfg = JSON.parse(fs.readFileSync(`${DIR}/game.json`, 'utf8'));
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8');

// 1. no new outside connections
const hosts = [...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase());
const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org'];
const bad = hosts.filter(h => !allowed.includes(h));
if (bad.length) fail('index.html talks to outside hosts: ' + [...new Set(bad)].join(', '));
for (const w of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'MediaRecorder', 'eval(', 'new Function']) if (html.includes(w)) fail('index.html uses ' + w);
const fetches = [...html.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map(m => m[1]).concat([...html.matchAll(/grown\('([^']+)'/g)].map(m => m[1]));
if (fetches.some(f => !['/api/log', 'game.json', '/api/config?game=', '/api/children', '/api/status?game=', '/api/review', '/api/notes', '/api/apply', '/api/dismiss', '/api/undo', '/audio/${CFG.voice}/${k}.mp3', '/api/device/link', '/api/config?game=', '/api/children'].includes(f))) fail('unexpected fetch: ' + fetches.join(', '));
const MUST = {
  'itsy-big-show': ['data-hold="home"', 'openGrown', 'timerMin', 'holdify'],
  'itsy-sleepy-kart': ['id="leave"', "location.href='/'", 'id="stick"', 'track(']
};
for (const must of MUST[GAME] || []) if (!html.includes(must)) fail('safety feature removed: ' + must);
if (!html.includes(`/*CFG*/${JSON.stringify(cfg)}/*END*/`)) fail(`built-in config out of sync; run node scripts/sync-cfg.mjs ${GAME}`);

// 2. it actually runs on an iPad-sized screen
const types = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  const f = path.join('site', p.endsWith('/') ? p + 'index.html' : p);
  if (!f.startsWith('site') || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/games/${GAME}/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
// the kart: starts, picks a world, drives with the keyboard and with the touch stick, honours its config
async function kartChecks() {
  for (const vp of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
    const page = await browser.newPage({ viewport: vp, hasTouch: true });
    page.on('pageerror', e => errors.push(`${vp.width}: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(url); await page.waitForTimeout(1200);
    if (await page.isVisible('#oops')) fail('kart could not start 3D');
    await page.click('#startBtn'); await page.waitForTimeout(600);
    if (!(await page.isVisible('#picker'))) fail('world picker did not appear');
    const worlds = cfg.worlds.filter(w => w.enabled).map(w => w.id === 'spider' ? '#pickSpider' : '#pickBed');
    await page.click(worlds[0]); await page.waitForTimeout(1200);
    if ((await page.evaluate(() => window._kart.state)) !== 'race') fail('race did not start');
    const d0 = await page.evaluate(() => window._kart.world().P.dist);
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowUp');
    const d1 = await page.evaluate(() => window._kart.world().P.dist);
    if (!(d1 > d0 + 5)) fail('kart did not drive');
    const sp = await page.evaluate(() => window._kart.world().P.speed);
    if (sp > cfg.max_speed + 1) fail('speed above max_speed');
    const laps = await page.$$eval('#laps span', e => e.length);
    if (laps !== cfg.laps) fail(`laps HUD shows ${laps}, config says ${cfg.laps}`);
    const q = await page.evaluate(() => window._kart.queue.map(e => e.e));
    for (const e of ['session', 'open', 'pick']) if (!q.includes(e)) fail('play tracking missing event ' + e);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    if (wide) fail(`page wider than screen at ${vp.width}px`);
    await page.close();
  }
}
try {
  if (GAME === 'itsy-sleepy-kart') await kartChecks();
  else for (const vp of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
    const page = await browser.newPage({ viewport: vp, hasTouch: true });
    page.on('pageerror', e => errors.push(`${vp.width}: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(url);
    await page.click('#go');
    await page.waitForTimeout(4500);
    if (!(await page.isVisible('#home'))) fail('home screen did not appear');
    const tiles = await page.$$eval('#tiles .tile', t => t.length);
    if (tiles !== cfg.activities.filter(a => a.enabled).length) fail(`expected ${cfg.activities.filter(a => a.enabled).length} tiles, got ${tiles}`);
    for (const a of cfg.activities.filter(a => a.enabled && a.id !== 'sing')) {
      await page.evaluate(id => window.__itsy.launch(id), a.id);
      await page.waitForTimeout(1200);
      if (['seq', 'bugs', 'letters'].includes(a.id)) {
        const s0 = await page.evaluate(() => window.__itsy.score);
        for (let i = 0; i < 4; i++) { const b = await page.$('.ch:not(.wrong):not(.right)'); if (!b) break; await b.tap({ force: true }); await page.waitForTimeout(250); if (await page.evaluate(() => window.__itsy.score) > s0) break; }
        if (!(await page.evaluate(() => window.__itsy.score) > s0)) fail(`${a.id}: could not answer a question`);
      }
      if (a.id === 'bubbles') { await page.waitForTimeout(1200); const b = await page.$('.bubble'); if (!b) fail('no bubbles appeared'); }
      if (a.id === 'board') { await page.tap('.lt >> nth=2', { force: true }); }
      await page.evaluate(() => window.__itsy.goHome('test'));
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.__itsy.openGrown());
    await page.waitForTimeout(300);
    if (!(await page.isVisible('#review'))) fail('grown-ups screen broken');
    // overflow check: nothing wider than the screen
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    if (wide) fail(`page wider than screen at ${vp.width}px`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
if (errors.length) fail('script errors:\n' + errors.join('\n'));
console.log('All checks passed.');
