// Per-family encryption for private text (AES-256-GCM, WebCrypto; works in Workers and Node 20).
// Stored form: "enc:v1:<iv base64>:<ciphertext base64>". Anything without that prefix is legacy plaintext.
// Each family has its own random 256-bit key ("DEK"). It is stored only in locked form:
//   - standard mode: locked with MASTER_KEY, a Cloudflare secret that is never in the database
//   - private mode:  locked with a key derived (PBKDF2) from the parent's passphrase, in their browser only;
//                    the server sees the DEK only inside a request the parent makes, and never stores it.
const te = new TextEncoder(), td = new TextDecoder();
export const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const isEnc = s => typeof s === 'string' && s.startsWith('enc:v1:');
const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}
async function open(key, s) {
  const [, , iv, ct] = s.split(':');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)));
}

// MASTER_KEY: 32 random bytes, written as base64 (44 characters) or hex (64 characters). Surrounding spaces are ignored.
function masterBytes(env) {
  const v = String(env.MASTER_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Uint8Array.from(v.match(/../g), h => parseInt(h, 16));
  try { const b = unb64(v); return b.length === 32 ? b : null; } catch { return null; }
}
export const masterReady = env => !!masterBytes(env);
async function masterKey(env) { const b = masterBytes(env); return b ? aesKey(b) : null; }

export const newDek = () => crypto.getRandomValues(new Uint8Array(32));
export async function lockWithMaster(env, dek) { const mk = await masterKey(env); if (!mk) throw new Error('MASTER_KEY is not set'); return seal(mk, dek); }

// The family's key for this request: from a DEK the parent sent (private mode), or unlocked with MASTER_KEY.
export async function familyKey(env, family, sentDek) {
  if (sentDek) { const raw = unb64(sentDek); if (raw.length !== 32) throw new Error('bad key'); return aesKey(raw); }
  const f = await env.DB.prepare('SELECT dek_wrapped, private_mode FROM families WHERE id = ?').bind(family).first();
  if (!f || f.private_mode) return null;               // private mode: only the parent can unlock
  if (!f.dek_wrapped) return null;                     // legacy family not upgraded yet (see /api/internal/encrypt-existing)
  const mk = await masterKey(env);
  if (!mk) throw new Error('MASTER_KEY is not set');   // never fall back to plaintext for an encrypted family
  return aesKey(await open(mk, f.dek_wrapped));
}

// key === null only for a legacy family that hasn't been upgraded yet: its text stays as it was until the upgrade runs.
export async function enc(key, text) {
  if (text == null || text === '') return text ?? null;
  if (!key) return String(text);
  return seal(key, te.encode(String(text)));
}
export async function dec(key, s) {
  if (!isEnc(s)) return s;
  if (!key) return null;
  try { return td.decode(await open(key, s)); } catch { return null; }
}

// Site-level secrets that belong to no family (the beta interest list): sealed with a key derived from MASTER_KEY.
async function siteKey(env, purpose) {
  const b = masterBytes(env); if (!b) return null;
  const base = await crypto.subtle.importKey('raw', b, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(purpose) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function siteSeal(env, purpose, text) { const k = await siteKey(env, purpose); if (!k) throw new Error('MASTER_KEY is not set'); return seal(k, te.encode(String(text))); }
export async function siteOpen(env, purpose, s) { const k = await siteKey(env, purpose); if (!k) return null; try { return td.decode(await open(k, s)); } catch { return null; } }
export async function siteHash(env, purpose, text) {
  const b = masterBytes(env); if (!b) throw new Error('MASTER_KEY is not set');
  const k = await crypto.subtle.importKey('raw', b, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, te.encode(purpose + ':' + text));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, '0')).join('');
}
