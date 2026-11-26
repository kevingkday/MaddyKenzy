// Tiny client for the site's private /api/internal endpoints.
export const api = async (path, body) => {
  const r = await fetch(process.env.SITE_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${process.env.INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};
