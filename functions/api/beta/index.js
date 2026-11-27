// Beta interest sign-up: email only. Stored encrypted; the site owner gets an email for each new sign-up
// (Cloudflare Email Service REST API, to a verified destination address) when NOTIFY_EMAIL is configured.
import { json, sessionUser, sha256 } from '../../../lib/server.js';
import { siteSeal, siteOpen, siteHash, masterReady } from '../../../lib/crypto.js';

const P = 'beta-signup';
const okEmail = e => e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(e);

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true });                 // honeypot: bots fill every field
  const email = String(body.email || '').trim().toLowerCase();
  if (!okEmail(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!masterReady(env)) return json({ error: 'Sign-ups are not open yet.' }, 503);

  const ip = await sha256('ip:' + (request.headers.get('cf-connecting-ip') || ''));
  const recent = await env.DB.prepare('SELECT COUNT(*) n FROM beta_signups WHERE ip_hash = ? AND created_at > unixepoch() - 3600').bind(ip).first();
  if (recent?.n >= 5) return json({ error: 'Too many sign-ups from here. Try again later.' }, 429);

  const hash = await siteHash(env, P, email);
  if (await env.DB.prepare('SELECT 1 FROM beta_signups WHERE email_hash = ?').bind(hash).first()) return json({ ok: true, already: true });
  const r = await env.DB.prepare('INSERT INTO beta_signups (email_enc, email_hash, ip_hash) VALUES (?, ?, ?)').bind(await siteSeal(env, P, email), hash, ip).run();

  const sent = await notify(env, email, request);
  if (sent) await env.DB.prepare('UPDATE beta_signups SET notified = 1 WHERE id = ?').bind(r.meta.last_row_id).run();
  return json({ ok: true });
}

// Admin only: the list, newest first.
export async function onRequestGet({ request, env }) {
  const u = await sessionUser(request, env);
  if (u?.role !== 'admin') return json({ error: 'Admins only.' }, 403);
  const { results } = await env.DB.prepare('SELECT id, email_enc, notified, created_at FROM beta_signups ORDER BY id DESC LIMIT 500').all();
  const list = [];
  for (const s of results) list.push({ id: s.id, email: await siteOpen(env, P, s.email_enc), notified: !!s.notified, at: s.created_at });
  return json({ count: list.length, list, email_ready: !!(env.NOTIFY_EMAIL && env.CF_EMAIL_TOKEN && env.CF_ACCOUNT_ID) });
}

async function notify(env, email, request) {
  if (!env.NOTIFY_EMAIL || !env.CF_EMAIL_TOKEN || !env.CF_ACCOUNT_ID) return false;
  const host = new URL(request.url).hostname.replace(/^www\./, '');
  const n = (await env.DB.prepare('SELECT COUNT(*) n FROM beta_signups').first())?.n || 1;
  const text = `New beta sign-up on ${host}:\n\n${email}\n\nThat's ${n} so far. See them all in the parent dashboard: https://${host}/app/`;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_EMAIL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        to: env.NOTIFY_EMAIL,
        from: { address: env.NOTIFY_FROM || `beta@${host}`, name: 'Maddy & Kenzy beta' },
        subject: `Beta sign-up #${n}: ${email}`,
        text
      })
    });
    if (!r.ok) console.log('beta notify failed', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) { console.log('beta notify error', e.message); return false; }
}
