// reset.mjs - One-time index reset endpoint
// Hit /api/reset once to clear bad articles, then delete this file
import { getStore } from "@netlify/blobs";

export default async (req) => {
  // Simple secret check so random people can't hit it
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (secret !== 'phiable-reset-2026') {
    return new Response('Forbidden', { status: 403 });
  }

  const store = getStore({ name: 'phiable-articles' });
  
  // Wipe the index
  await store.setJSON('_index', { articles: [], updated: new Date().toISOString() });
  
  return new Response(JSON.stringify({ ok: true, message: 'Index cleared. Cron will repopulate.' }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/reset' };
