// Tiny client for the site's private /api/internal endpoints, and the Claude call used by the reviewer and the playbook rethink.
import fs from 'node:fs';
for (const k of ['SITE_URL', 'INTERNAL_TOKEN']) if (!process.env[k]) { console.log(`Missing GitHub secret ${k}. Add it under Settings -> Secrets and variables -> Actions.`); process.exit(1); }
export const api = async (path, body) => {
  const r = await fetch(process.env.SITE_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${process.env.INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};

const MODEL = process.env.MODEL || 'claude-opus-5-5';
export async function askClaude(system, user) {
  if (process.env.MOCK_REPLY) return JSON.parse(fs.readFileSync(process.env.MOCK_REPLY, 'utf8')); // local testing only
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 12000, stream: true, system, messages: [{ role: 'user', content: user }] })
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}`);
  let text = '', buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'error') throw new Error('Claude API stream error');
      if (ev.type === 'content_block_delta' && ev.delta?.text) text += ev.delta.text;
    }
  }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}
