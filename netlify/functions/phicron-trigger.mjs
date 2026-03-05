// phicron-trigger.mjs — Start or stop the phicron engine
// GET  /api/phicron-trigger?secret=phiable-reset-2026        → start
// GET  /api/phicron-trigger?secret=phiable-reset-2026&stop=1 → stop

import { getStore } from "@netlify/blobs";

const SECRET = 'phiable-reset-2026';

export default async (req) => {
  const url = new URL(req.url);
  const headers = { 'Content-Type': 'application/json' };

  if (url.searchParams.get('secret') !== SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers });
  }

  const store = getStore('articles');

  // STOP
  if (url.searchParams.get('stop') === '1') {
    await store.setJSON('_cron_stop', { stopped: true, ts: Date.now() });
    return new Response(JSON.stringify({ ok: true, status: 'stopped' }), { status: 200, headers });
  }

  // START — clear stop flag then fire phicron
  try { await store.delete('_cron_stop'); } catch(e) {}

  const runUrl = new URL(req.url);
  runUrl.pathname = '/api/phicron-run';
  runUrl.search = '';

  fetch(runUrl.toString(), { method: 'POST' }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, status: 'started', url: runUrl.toString() }), { status: 200, headers });
};

export const config = { path: '/api/phicron-trigger' };
