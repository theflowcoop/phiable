// reset.mjs - One-time index reset endpoint
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== 'phiable-reset-2026') {
    return new Response('Forbidden', { status: 403 });
  }
  const store = getStore('articles');
  const empty = { articles: [], updated: new Date().toISOString() };
  await Promise.all([
    store.setJSON('_index',   empty),
    store.setJSON('_index_a', empty),
    store.setJSON('_index_b', empty),
  ]);
  return new Response(JSON.stringify({ ok: true, message: 'All shards cleared.' }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/reset' };
