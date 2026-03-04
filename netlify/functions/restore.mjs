// ============================================================
// restore.mjs — Restore article index from a dated backup
//
// GET /api/restore?secret=phiable-reset-2026
//   → lists available backup dates
//
// GET /api/restore?secret=phiable-reset-2026&date=YYYY-MM-DD
//   → restores _index_a from that date's backup
//
// Backups are written daily by phicron2.mjs as _index_backup_YYYY-MM-DD
// If you lose your index, call this endpoint to recover it.
// ============================================================

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const headers = { "Content-Type": "application/json" };
  const url = new URL(req.url);

  if (url.searchParams.get('secret') !== 'phiable-reset-2026') {
    return new Response('Forbidden', { status: 403, headers });
  }

  const artStore = getStore('articles');
  const date = url.searchParams.get('date');

  // No date = list available backups
  if (!date) {
    try {
      const all = await artStore.list();
      const backups = (all.blobs || [])
        .filter(b => b.key.startsWith('_index_backup_'))
        .map(b => ({ key: b.key, date: b.key.replace('_index_backup_', '') }))
        .sort((a, b) => b.date.localeCompare(a.date));

      return new Response(JSON.stringify({
        ok: true,
        message: backups.length
          ? `Found ${backups.length} backups. Use ?date=YYYY-MM-DD to restore one.`
          : 'No backups found yet. Backups are written daily by phicron.',
        backups
      }), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
  }

  // Date provided = restore from that backup
  const backupKey = `_index_backup_${date}`;
  try {
    const backup = await artStore.get(backupKey, { type: 'json' });
    if (!backup) {
      return new Response(JSON.stringify({
        ok: false,
        error: `No backup found for ${date}. Call /api/restore without a date to list available backups.`
      }), { status: 404, headers });
    }

    const count = backup.articles?.length || 0;

    // Safety: don't restore an empty backup
    if (count === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Backup for ${date} is empty. Refusing to restore.`
      }), { status: 400, headers });
    }

    // Restore
    await artStore.setJSON('_index_a', backup);

    return new Response(JSON.stringify({
      ok: true,
      message: `Restored ${count} articles from backup ${date}.`,
      articlesRestored: count,
      backupDate: date
    }), { status: 200, headers });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/restore' };
