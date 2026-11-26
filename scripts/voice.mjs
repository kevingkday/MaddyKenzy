// Makes the spoken clips for one family in their chosen ElevenLabs voice.
// It loads the game headlessly to list every line it can say, adds lines that recently fell back
// to the iPad voice, skips clips that already exist, and stores the rest through /api/internal/voice.
//   FAMILY=maddykenzy MODE=sample|all [GAME=itsy-big-show] [CONFIG_FILE=.candidate.json] node scripts/voice.mjs
// Logs print counts only (lines can include the children's names).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

for (const k of ['SITE_URL', 'INTERNAL_TOKEN']) if (!process.env[k]) { console.log(`Missing GitHub secret ${k}. Add it under Settings -> Secrets and variables -> Actions.`); process.exit(1); }
const FAMILY = process.env.FAMILY, GAME = process.env.GAME || 'itsy-big-show', MODE = process.env.MODE || 'all';
const MAX = +(process.env.MAX_CLIPS || 800), KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
if (!/^[a-z0-9-]{1,40}$/.test(FAMILY || '')) throw new Error('FAMILY required');
if (!KEY) { console.log('No ELEVENLABS_API_KEY; skipping voice clips.'); process.exit(0); }

const site = process.env.SITE_URL.replace(/\/$/, ''), auth = { authorization: `Bearer ${process.env.INTERNAL_TOKEN}` };
const ctx = await (await fetch(`${site}/api/internal/voice?family=${FAMILY}`, { headers: auth })).json();
if (!ctx.voice) { console.log('This family has no voice set; skipping.'); process.exit(0); }
const config = process.env.CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8')).config : ctx.configs?.[GAME];

// list the lines by asking the game itself
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/') || p.startsWith('/audio/')) { res.writeHead(404); return res.end(); }
  const f = path.join('site', p.endsWith('/') ? p + 'index.html' : p);
  if (!f.startsWith('site') || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let lines;
try {
  const page = await browser.newPage();
  await page.route(/fonts\./, r => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/games/${GAME}/index.html`);
  await page.waitForFunction(() => window.__itsy?.phrases);
  lines = await page.evaluate(({ config, kids, misses, mode }) => {
    const I = window.__itsy; if (config) I.setCfg(config);
    if (mode === 'sample') return I.SAMPLES.flatMap(t => I.segs(t)).map(s => ({ key: s.key, text: s.gen }));
    const all = I.phrases(kids);
    for (const m of misses) for (const s of I.segs(m)) all.push({ key: s.key, text: s.gen });
    return all;
  }, { config, kids: ctx.children, misses: ctx.misses, mode: MODE });
} finally { await browser.close(); server.close(); }

const have = new Set(ctx.have), seen = new Set();
const todo = lines.filter(l => !have.has(l.key) && !seen.has(l.key) && seen.add(l.key)).slice(0, MAX);
console.log(`${lines.length} lines in the game, ${have.size} clips already made, ${todo.length} to make now.`);

async function tts(text) {
  if (process.env.MOCK_TTS_FILE) return fs.readFileSync(process.env.MOCK_TTS_FILE); // local testing only
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ctx.voice}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true } })
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 401 || r.status === 403 || r.status === 422) throw new Error(`ElevenLabs refused (${r.status}): check the API key, voice id and plan`);
    await new Promise(s => setTimeout(s, 2000 * (attempt + 1)));
  }
  throw new Error('ElevenLabs kept failing');
}
let made = 0, failed = 0;
async function worker(queue) {
  for (let l; (l = queue.shift());) {
    try {
      const mp3 = await tts(l.text);
      const r = await fetch(`${site}/api/internal/voice?family=${FAMILY}&voice=${ctx.voice}&hash=${l.key}`, {
        method: 'POST', headers: { ...auth, 'content-type': 'audio/mpeg', 'x-text': encodeURIComponent(l.text) }, body: mp3
      });
      if (!r.ok) throw new Error(`store ${r.status}`);
      made++;
    } catch (e) {
      failed++;
      if (/refused/.test(e.message)) { console.log(e.message); queue.length = 0; }
    }
  }
}
const queue = [...todo];
await Promise.all([worker(queue), worker(queue), worker(queue)]);
console.log(`Made ${made} clips${failed ? `, ${failed} failed` : ''}.`);
if (failed && !made) process.exit(1);
