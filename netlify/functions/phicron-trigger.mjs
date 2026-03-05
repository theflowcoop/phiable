// phicron-trigger.mjs — Start or stop the phicron engine
// GET  /api/phicron-trigger?secret=phiable-reset-2026        → clears stop flag (start)
// GET  /api/phicron-trigger?secret=phiable-reset-2026&stop=1 → sets stop flag (stop)
//
// Note: phicron3.mjs runs on a schedule (* * * * *) automatically.
// This endpoint just controls the stop flag that phicron checks at the top of each run.

import { getStore } from "@netlify/blobs";

const SECRET = 'phiable-reset-2026';

export default async (req) => {
  const url = new URL(req.url);
  const headers = { 'Content-Type': 'application/json' };

  if (url.searchParams.get('secret') !== SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers });
  }

  const store = getStore('articles');

  // STOP — set the flag, phicron will see it and halt
  if (url.searchParams.get('stop') === '1') {
    await store.setJSON('_cron_stop', { stopped: true, ts: Date.now() });
    return new Response(JSON.stringify({ ok: true, status: 'stopped', note: 'Phicron will stop after its current run completes.' }), { status: 200, headers });
  }

  // START — clear stop flag. Phicron runs on schedule every minute automatically.
  try { await store.delete('_cron_stop'); } catch(e) {}

  return new Response(JSON.stringify({
    ok: true,
    status: 'started',
    note: 'Stop flag cleared. Phicron3 runs automatically every minute via schedule.'
  }), { status: 200, headers });
};

export const config = { path: '/api/phicron-trigger' };
