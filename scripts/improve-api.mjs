// Tiny client for the site's private /api/internal endpoints, and the Claude call used by the reviewer and the playbook rethink.
import fs from 'node:fs';
for (const k of ['SITE_URL', 'INTERNAL_TOKEN']) if (!process.env[k]) { console.log(`Missing GitHub secret ${k}. Add it under Settings -> Secrets and variables -> Actions.`); process.exit(1); }
export const api = async (path, body) => {
  const r = await fetch(process.env.SITE_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${process.env.INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) { const why = (await r.json().catch(() => ({}))).error; throw new Error(`${path} -> ${r.status}${why ? ': ' + why : ''}`); }
  return r.json();
};

// Claude settings for lib/review.js callClaude (MOCK_REPLY = a file with a canned reply, local testing only)
export const claudeOpts = () => ({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL || undefined, mock: process.env.MOCK_REPLY ? fs.readFileSync(process.env.MOCK_REPLY, 'utf8') : undefined });
